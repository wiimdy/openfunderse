import { createPublicClient, defineChain, encodeFunctionData, http, parseAbi, type Address } from 'viem';
import type { Hex, IntentExecutionRouteInput, TradeIntent } from '@claw/protocol-sdk';
import { StrategyAaClient } from './lib/aa-client.js';
import { createRelayerClient, type ReadyExecutionPayloadItem } from './lib/relayer-client.js';

interface ParsedCli {
  command?: string;
  options: Map<string, string>;
  flags: Set<string>;
}

interface CoreDryRunResult {
  exists: boolean;
  approved: boolean;
  notExpired: boolean;
  notExecuted: boolean;
  withinNotional: boolean;
  slippageOk: boolean;
  allowlistOk: boolean;
  coreNotPaused: boolean;
  vaultNotPaused: boolean;
  tokenInAllowed: boolean;
  tokenOutAllowed: boolean;
  adapterAllowed: boolean;
  lensConfigured: boolean;
  quoteOk: boolean;
  expectedAmountOut: bigint;
  failureCode: Hex;
}

const INTENT_BOOK_ABI = parseAbi([
  'function attestIntent(bytes32 intentHash, address[] verifiers, (uint64 expiresAt, uint256 nonce, bytes signature)[] attestations)',
  'function isIntentApproved(bytes32 intentHash) view returns (bool)'
]);

const CORE_ABI = parseAbi([
  'function dryRunIntentExecution(bytes32 intentHash, (address tokenIn,address tokenOut,uint256 amountIn,uint256 quoteAmountOut,uint256 minAmountOut,address adapter,bytes adapterData) req) view returns ((bool exists,bool approved,bool notExpired,bool notExecuted,bool withinNotional,bool slippageOk,bool allowlistOk,bool coreNotPaused,bool vaultNotPaused,bool tokenInAllowed,bool tokenOutAllowed,bool adapterAllowed,bool lensConfigured,bool quoteOk,bytes32 snapshotHash,uint64 deadline,uint16 maxSlippageBps,uint256 maxNotional,uint256 expectedAmountOut,bytes32 expectedAllowlistHash,bytes32 computedAllowlistHash,bytes32 quoteReasonCode,bytes32 failureCode))',
  'function executeIntent(bytes32 intentHash, (address tokenIn,address tokenOut,uint256 amountIn,uint256 quoteAmountOut,uint256 minAmountOut,address adapter,bytes adapterData) req) returns (uint256 amountOut)'
]);

const parseCli = (argv: string[]): ParsedCli => {
  const [command, ...rest] = argv;
  const options = new Map<string, string>();
  const flags = new Set<string>();

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    if (key.includes('=')) {
      const [left, ...right] = key.split('=');
      options.set(left, right.join('='));
      continue;
    }
    const next = rest[i + 1];
    if (next && !next.startsWith('--')) {
      options.set(key, next);
      i += 1;
      continue;
    }
    flags.add(key);
  }

  return { command, options, flags };
};

const requiredOption = (parsed: ParsedCli, key: string): string => {
  const value = parsed.options.get(key);
  if (!value) {
    throw new Error(`missing required option --${key}`);
  }
  return value;
};

const optionOrEnv = (
  parsed: ParsedCli,
  key: string,
  envKey: string
): string => {
  const cli = parsed.options.get(key);
  if (cli && cli.length > 0) {
    return cli;
  }
  const envValue = process.env[envKey];
  if (envValue && envValue.length > 0) {
    return envValue;
  }
  throw new Error(`missing required option --${key} (or env ${envKey})`);
};

const optionNumber = (parsed: ParsedCli, key: string, fallback: number): number => {
  const raw = parsed.options.get(key);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`--${key} must be a number`);
  }
  return Math.trunc(value);
};

const jsonStringify = (value: unknown): string => {
  return JSON.stringify(
    value,
    (_key, inner) => (typeof inner === 'bigint' ? inner.toString() : inner),
    2
  );
};

const parseAddress = (value: string, label: string): Address => {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`${label} must be an address`);
  }
  return value as Address;
};

const parseHex = (value: string, label: string): Hex => {
  if (!/^0x[0-9a-fA-F]*$/.test(value)) {
    throw new Error(`${label} must be a hex string`);
  }
  return value as Hex;
};

const executionRequestFromPayload = (
  item: ReadyExecutionPayloadItem
): {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  quoteAmountOut: bigint;
  minAmountOut: bigint;
  adapter: Address;
  adapterData: Hex;
} => {
  const intent = item.intent as unknown as Record<string, string>;
  const route = item.executionRoute as unknown as Record<string, string>;

  return {
    tokenIn: parseAddress(String(route.tokenIn ?? intent.tokenIn), 'executionRoute.tokenIn'),
    tokenOut: parseAddress(String(route.tokenOut ?? intent.tokenOut), 'executionRoute.tokenOut'),
    amountIn: BigInt(String(intent.amountIn)),
    quoteAmountOut: BigInt(String(route.quoteAmountOut)),
    minAmountOut: BigInt(String(route.minAmountOut ?? intent.minAmountOut)),
    adapter: parseAddress(String(route.adapter), 'executionRoute.adapter'),
    adapterData: parseHex(String(route.adapterData ?? '0x'), 'executionRoute.adapterData')
  };
};

const dryRunPass = (result: CoreDryRunResult, minAmountOut: bigint): boolean => {
  return (
    result.exists &&
    result.approved &&
    result.notExpired &&
    result.notExecuted &&
    result.withinNotional &&
    result.slippageOk &&
    result.allowlistOk &&
    result.coreNotPaused &&
    result.vaultNotPaused &&
    result.tokenInAllowed &&
    result.tokenOutAllowed &&
    result.adapterAllowed &&
    result.lensConfigured &&
    result.quoteOk &&
    result.expectedAmountOut >= minAmountOut
  );
};

const runStrategyAttestOnchain = async (parsed: ParsedCli): Promise<void> => {
  const fundId = requiredOption(parsed, 'fund-id');
  const intentHash = parseHex(requiredOption(parsed, 'intent-hash'), 'intent-hash');
  const intentBookAddress = parseAddress(
    optionOrEnv(parsed, 'intent-book-address', 'INTENT_BOOK_ADDRESS'),
    'intent-book-address'
  );
  const skipAck = parsed.flags.has('skip-relayer-ack');
  const expirySafetySeconds = optionNumber(parsed, 'expiry-safety-seconds', 30);
  if (expirySafetySeconds < 0) {
    throw new Error('--expiry-safety-seconds must be a non-negative number');
  }

  const relayer = createRelayerClient();
  const aa = StrategyAaClient.fromEnv();
  const bundle = await relayer.getIntentOnchainBundle(fundId, intentHash);

  const thresholdReached =
    BigInt(String(bundle.attestedWeight ?? '0')) >= BigInt(String(bundle.thresholdWeight ?? '0'));
  if (!thresholdReached) {
    throw new Error(
      `threshold not reached: attestedWeight=${bundle.attestedWeight} thresholdWeight=${bundle.thresholdWeight}`
    );
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiryCutoff = BigInt(nowSeconds + expirySafetySeconds);
  const validAttestations = (bundle.attestations ?? []).filter((item) => {
    return BigInt(String(item.expiresAt)) > expiryCutoff;
  });
  const filteredExpiredCount = (bundle.attestations ?? []).length - validAttestations.length;

  if (validAttestations.length === 0) {
    const reason = `no valid attestations left after expiry filter (cutoff=${expiryCutoff.toString()})`;
    if (!skipAck) {
      await relayer.markIntentOnchainFailed(fundId, intentHash, reason, 30_000);
    }
    throw new Error(reason);
  }

  const verifiers = validAttestations.map((item) =>
    parseAddress(String(item.verifier), 'attestation.verifier')
  );
  const attestations = validAttestations.map((item) => ({
    expiresAt: BigInt(String(item.expiresAt)),
    nonce: BigInt(String(item.nonce)),
    signature: parseHex(String(item.signature), 'attestation.signature')
  }));

  const chainId = Number(process.env.CHAIN_ID ?? '10143');
  if (!Number.isFinite(chainId) || chainId <= 0) {
    throw new Error('CHAIN_ID must be a positive number');
  }
  const rpcUrl = process.env.STRATEGY_AA_RPC_URL ?? process.env.RPC_URL ?? '';
  if (!rpcUrl) {
    throw new Error('STRATEGY_AA_RPC_URL (or RPC_URL) is required');
  }
  const publicClient = createPublicClient({
    chain: defineChain({
      id: Math.trunc(chainId),
      name: `strategy-aa-${Math.trunc(chainId)}`,
      nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
      rpcUrls: {
        default: { http: [rpcUrl] },
        public: { http: [rpcUrl] }
      }
    }),
    transport: http(rpcUrl)
  });

  const data = encodeFunctionData({
    abi: INTENT_BOOK_ABI,
    functionName: 'attestIntent',
    args: [intentHash, verifiers, attestations]
  });

  const userOp = await aa.sendExecute({
    target: intentBookAddress,
    data
  });

  if (!userOp.transactionHash) {
    const reason = 'missing transactionHash in user operation receipt';
    if (!skipAck) {
      await relayer.markIntentOnchainFailed(fundId, intentHash, reason, 30_000);
    }
    throw new Error(reason);
  }

  const approvedOnchain = await publicClient.readContract({
    address: intentBookAddress,
    abi: INTENT_BOOK_ABI,
    functionName: 'isIntentApproved',
    args: [intentHash]
  });
  if (!approvedOnchain) {
    const reason = 'onchain check failed: intent is not approved after attestation transaction';
    if (!skipAck) {
      await relayer.markIntentOnchainFailed(fundId, intentHash, reason, 30_000);
    }
    throw new Error(reason);
  }

  if (!skipAck) {
    await relayer.markIntentOnchainAttested(fundId, intentHash, userOp.transactionHash);
  }

  console.log(
    jsonStringify({
      status: 'OK',
      command: 'strategy-attest-onchain',
      fundId,
      intentHash,
      attestationCount: attestations.length,
      filteredExpiredCount,
      userOpHash: userOp.userOpHash,
      txHash: userOp.transactionHash,
      relayerAck: !skipAck
    })
  );
};

const runStrategyExecuteReady = async (parsed: ParsedCli): Promise<void> => {
  const fundId = requiredOption(parsed, 'fund-id');
  const coreAddress = parseAddress(
    optionOrEnv(parsed, 'core-address', 'CLAW_CORE_ADDRESS'),
    'core-address'
  );
  const limit = optionNumber(parsed, 'limit', 20);
  const offset = optionNumber(parsed, 'offset', 0);
  const skipAck = parsed.flags.has('skip-relayer-ack');
  const retryDelayMs = optionNumber(parsed, 'retry-delay-ms', 30_000);

  const relayer = createRelayerClient();
  const aa = StrategyAaClient.fromEnv();
  const payload = await relayer.listReadyExecutionPayloads(fundId, { limit, offset });

  const chainId = Number(process.env.CHAIN_ID ?? '10143');
  const rpcUrl = process.env.STRATEGY_AA_RPC_URL ?? process.env.RPC_URL ?? '';
  if (!rpcUrl) {
    throw new Error('STRATEGY_AA_RPC_URL (or RPC_URL) is required');
  }
  const publicClient = createPublicClient({
    chain: defineChain({
      id: chainId,
      name: `strategy-aa-${chainId}`,
      nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
      rpcUrls: {
        default: { http: [rpcUrl] },
        public: { http: [rpcUrl] }
      }
    }),
    transport: http(rpcUrl)
  });

  const results: Array<Record<string, unknown>> = [];
  for (const item of payload.items ?? []) {
    const intentHash = parseHex(String(item.intentHash), 'intentHash');
    try {
      const req = executionRequestFromPayload(item);
      const dryRun = (await publicClient.readContract({
        address: coreAddress,
        abi: CORE_ABI,
        functionName: 'dryRunIntentExecution',
        args: [intentHash, req]
      })) as CoreDryRunResult;

      if (!dryRunPass(dryRun, req.minAmountOut)) {
        const reason = `dry-run failed: failureCode=${dryRun.failureCode}`;
        if (!skipAck) {
          await relayer.markIntentOnchainFailed(fundId, intentHash, reason, retryDelayMs);
        }
        results.push({
          intentHash,
          ok: false,
          reason
        });
        continue;
      }

      const data = encodeFunctionData({
        abi: CORE_ABI,
        functionName: 'executeIntent',
        args: [intentHash, req]
      });
      const userOp = await aa.sendExecute({
        target: coreAddress,
        data
      });

      if (!skipAck && userOp.transactionHash) {
        await relayer.markIntentOnchainExecuted(fundId, intentHash, userOp.transactionHash);
      }

      results.push({
        intentHash,
        ok: true,
        userOpHash: userOp.userOpHash,
        txHash: userOp.transactionHash
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!skipAck) {
        await relayer.markIntentOnchainFailed(fundId, intentHash, message, retryDelayMs);
      }
      results.push({
        intentHash,
        ok: false,
        reason: message
      });
    }
  }

  console.log(
    jsonStringify({
      status: 'OK',
      command: 'strategy-execute-ready',
      fundId,
      processed: results.length,
      total: payload.total ?? 0,
      results
    })
  );
};

const printUsage = (): void => {
  console.log(`
[agents] strategy commands

strategy-attest-onchain
  --fund-id <id> --intent-hash <0x...> [--intent-book-address <0x...>]
  [--expiry-safety-seconds <n>] [--skip-relayer-ack]

strategy-execute-ready
  --fund-id <id> [--core-address <0x...>] [--limit <n>] [--offset <n>]
  [--retry-delay-ms <n>] [--skip-relayer-ack]
`);
};

export const runStrategyCli = async (argv: string[]): Promise<boolean> => {
  const parsed = parseCli(argv);
  const command = parsed.command ?? '';
  if (!command.startsWith('strategy-')) {
    return false;
  }

  if (parsed.flags.has('help') || command === 'strategy-help') {
    printUsage();
    return true;
  }

  if (command === 'strategy-attest-onchain') {
    await runStrategyAttestOnchain(parsed);
    return true;
  }
  if (command === 'strategy-execute-ready') {
    await runStrategyExecuteReady(parsed);
    return true;
  }

  throw new Error(`unknown strategy command: ${command}`);
};
