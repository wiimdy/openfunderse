import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient,
  decodeEventLog,
  defineChain,
  encodeFunctionData,
  http,
  parseAbi,
  type Address,
  type Hex
} from 'viem';
import type { IntentExecutionRouteInput, TradeIntent } from '@claw/protocol-sdk';
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

interface FundDeployConfigInput {
  fundOwner: Address;
  strategyAgent: Address;
  snapshotBook: Address;
  asset: Address;
  vaultName: string;
  vaultSymbol: string;
  intentThresholdWeight: bigint;
  nadfunLens: Address;
  initialVerifiers: Address[];
  initialVerifierWeights: bigint[];
  initialAllowedTokens: Address[];
  initialAllowedAdapters: Address[];
}

interface FundDeploymentEventResult {
  fundId: bigint;
  fundOwner: Address;
  strategyAgent: Address;
  intentBookAddress: Address;
  clawCoreAddress: Address;
  clawVaultAddress: Address;
  snapshotBookAddress: Address;
  assetAddress: Address;
}

const INTENT_BOOK_ABI = parseAbi([
  'function attestIntent(bytes32 intentHash, address[] verifiers, (uint64 expiresAt, uint256 nonce, bytes signature)[] attestations)',
  'function isIntentApproved(bytes32 intentHash) view returns (bool)'
]);

const CORE_ABI = parseAbi([
  'function dryRunIntentExecution(bytes32 intentHash, (address tokenIn,address tokenOut,uint256 amountIn,uint256 quoteAmountOut,uint256 minAmountOut,address adapter,bytes adapterData) req) view returns ((bool exists,bool approved,bool notExpired,bool notExecuted,bool withinNotional,bool slippageOk,bool allowlistOk,bool coreNotPaused,bool vaultNotPaused,bool tokenInAllowed,bool tokenOutAllowed,bool adapterAllowed,bool lensConfigured,bool quoteOk,bytes32 snapshotHash,uint64 deadline,uint16 maxSlippageBps,uint256 maxNotional,uint256 expectedAmountOut,bytes32 expectedAllowlistHash,bytes32 computedAllowlistHash,bytes32 quoteReasonCode,bytes32 failureCode))',
  'function executeIntent(bytes32 intentHash, (address tokenIn,address tokenOut,uint256 amountIn,uint256 quoteAmountOut,uint256 minAmountOut,address adapter,bytes adapterData) req) returns (uint256 amountOut)'
]);

const FUND_FACTORY_ABI = parseAbi([
  'function createFund((address fundOwner,address strategyAgent,address snapshotBook,address asset,string vaultName,string vaultSymbol,uint256 intentThresholdWeight,address nadfunLens,address[] initialVerifiers,uint256[] initialVerifierWeights,address[] initialAllowedTokens,address[] initialAllowedAdapters) cfg) returns (uint256 fundId, address intentBook, address core, address vault)',
  'event FundDeployed(uint256 indexed fundId, address indexed fundOwner, address indexed strategyAgent, address intentBook, address core, address vault, address snapshotBook, address asset)'
]);

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;
const DEFAULT_MIN_AA_BALANCE_WEI = 10_000_000_000_000_000n; // 0.01 MON
const DEFAULT_AGENTS_ENV_PATH = fileURLToPath(new URL('../.env', import.meta.url));

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

const optionBigInt = (parsed: ParsedCli, key: string): bigint | undefined => {
  const raw = parsed.options.get(key);
  if (!raw || raw.trim().length === 0) {
    return undefined;
  }
  try {
    return BigInt(raw);
  } catch {
    throw new Error(`--${key} must be an integer`);
  }
};

const optionBigIntOrEnv = (
  parsed: ParsedCli,
  key: string,
  envKey: string,
  fallback: bigint
): bigint => {
  const fromCli = optionBigInt(parsed, key);
  if (fromCli !== undefined) {
    return fromCli;
  }
  const envRaw = process.env[envKey];
  if (!envRaw || envRaw.trim().length === 0) {
    return fallback;
  }
  try {
    return BigInt(envRaw);
  } catch {
    throw new Error(`${envKey} must be an integer`);
  }
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

const upsertEnvValue = async (envFilePath: string, key: string, value: string): Promise<void> => {
  let raw = '';
  try {
    raw = await readFile(envFilePath, 'utf8');
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code !== 'ENOENT') {
      throw error;
    }
  }

  const lines = raw.length > 0 ? raw.split(/\r?\n/) : [];
  const entry = `${key}=${value}`;
  const index = lines.findIndex((line) => line.startsWith(`${key}=`));
  if (index >= 0) {
    lines[index] = entry;
  } else {
    lines.push(entry);
  }

  const normalized = lines.filter((_line, idx) => !(idx === lines.length - 1 && lines[idx] === ''));
  await writeFile(envFilePath, `${normalized.join('\n')}\n`, 'utf8');
};

const parseOptionalAddress = (
  value: unknown,
  fallback: Address,
  label: string
): Address => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return fallback;
  }
  return parseAddress(value, label);
};

const parseAddressArray = (value: unknown, label: string): Address[] => {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value.map((entry, index) => parseAddress(String(entry), `${label}[${index}]`));
};

const parseBigIntArray = (value: unknown, label: string): bigint[] => {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value.map((entry, index) => {
    try {
      return BigInt(String(entry));
    } catch {
      throw new Error(`${label}[${index}] must be an integer`);
    }
  });
};

const parseDeployConfig = (
  rawJson: string,
  strategyAddressFallback: Address
): FundDeployConfigInput => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson) as unknown;
  } catch {
    throw new Error('--deploy-config-json must be valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('--deploy-config-json must be a JSON object');
  }
  const value = parsed as Record<string, unknown>;
  const fundOwner = parseAddress(String(value.fundOwner ?? ''), 'deployConfig.fundOwner');
  const snapshotBook = parseAddress(String(value.snapshotBook ?? ''), 'deployConfig.snapshotBook');
  const asset = parseAddress(String(value.asset ?? ''), 'deployConfig.asset');
  const vaultName = String(value.vaultName ?? '').trim();
  const vaultSymbol = String(value.vaultSymbol ?? '').trim();
  if (!vaultName || !vaultSymbol) {
    throw new Error('deployConfig.vaultName and deployConfig.vaultSymbol are required');
  }

  const initialVerifiers = parseAddressArray(value.initialVerifiers, 'deployConfig.initialVerifiers');
  const initialVerifierWeights = parseBigIntArray(
    value.initialVerifierWeights,
    'deployConfig.initialVerifierWeights'
  );
  if (initialVerifiers.length !== initialVerifierWeights.length) {
    throw new Error(
      'deployConfig.initialVerifiers and deployConfig.initialVerifierWeights lengths must match'
    );
  }
  if (initialVerifierWeights.some((weight) => weight <= 0n)) {
    throw new Error('deployConfig.initialVerifierWeights must be positive integers');
  }

  const intentThresholdWeight = BigInt(String(value.intentThresholdWeight ?? '0'));
  if (intentThresholdWeight <= 0n) {
    throw new Error('deployConfig.intentThresholdWeight must be positive');
  }

  return {
    fundOwner,
    strategyAgent: parseOptionalAddress(
      value.strategyAgent,
      strategyAddressFallback,
      'deployConfig.strategyAgent'
    ),
    snapshotBook,
    asset,
    vaultName,
    vaultSymbol,
    intentThresholdWeight,
    nadfunLens: parseOptionalAddress(value.nadfunLens, ZERO_ADDRESS as Address, 'deployConfig.nadfunLens'),
    initialVerifiers,
    initialVerifierWeights,
    initialAllowedTokens: parseAddressArray(
      value.initialAllowedTokens,
      'deployConfig.initialAllowedTokens'
    ),
    initialAllowedAdapters: parseAddressArray(
      value.initialAllowedAdapters,
      'deployConfig.initialAllowedAdapters'
    )
  };
};

const extractFundDeployedLog = (
  logs: Array<{
    address: Address;
    data: Hex;
    topics: readonly Hex[];
  }>,
  factoryAddress: Address
): FundDeploymentEventResult | null => {
  const lowerFactory = factoryAddress.toLowerCase();
  for (const log of logs) {
    if (log.address.toLowerCase() !== lowerFactory) {
      continue;
    }
    try {
      const topics = [...log.topics];
      if (topics.length === 0) {
        continue;
      }
      const decoded = decodeEventLog({
        abi: FUND_FACTORY_ABI,
        data: log.data,
        topics: topics as [Hex, ...Hex[]],
        strict: false
      });
      if (decoded.eventName !== 'FundDeployed') {
        continue;
      }
      const args = decoded.args as {
        fundId?: bigint;
        fundOwner?: Address;
        strategyAgent?: Address;
        intentBook?: Address;
        core?: Address;
        vault?: Address;
        snapshotBook?: Address;
        asset?: Address;
      };
      if (
        args.fundId === undefined ||
        !args.fundOwner ||
        !args.strategyAgent ||
        !args.intentBook ||
        !args.core ||
        !args.vault ||
        !args.snapshotBook ||
        !args.asset
      ) {
        continue;
      }
      return {
        fundId: args.fundId,
        fundOwner: args.fundOwner,
        strategyAgent: args.strategyAgent,
        intentBookAddress: args.intentBook,
        clawCoreAddress: args.core,
        clawVaultAddress: args.vault,
        snapshotBookAddress: args.snapshotBook,
        assetAddress: args.asset
      };
    } catch {
      continue;
    }
  }
  return null;
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
  const strategyAaAddress = parseAddress(
    optionOrEnv(parsed, 'strategy-aa-account-address', 'STRATEGY_AA_ACCOUNT_ADDRESS'),
    'strategy-aa-account-address'
  );
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
  const aa = StrategyAaClient.fromEnv({
    smartAccount: strategyAaAddress
  });
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
  const strategyAaAddress = parseAddress(
    optionOrEnv(parsed, 'strategy-aa-account-address', 'STRATEGY_AA_ACCOUNT_ADDRESS'),
    'strategy-aa-account-address'
  );
  const coreAddress = parseAddress(
    optionOrEnv(parsed, 'core-address', 'CLAW_CORE_ADDRESS'),
    'core-address'
  );
  const limit = optionNumber(parsed, 'limit', 20);
  const offset = optionNumber(parsed, 'offset', 0);
  const skipAck = parsed.flags.has('skip-relayer-ack');
  const retryDelayMs = optionNumber(parsed, 'retry-delay-ms', 30_000);

  const relayer = createRelayerClient();
  const aa = StrategyAaClient.fromEnv({
    smartAccount: strategyAaAddress
  });
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

const runStrategyCreateFund = async (parsed: ParsedCli): Promise<void> => {
  const fundId = requiredOption(parsed, 'fund-id');
  const fundName = requiredOption(parsed, 'fund-name');
  const strategyBotId = optionOrEnv(parsed, 'strategy-bot-id', 'BOT_ID');
  const strategyBotAddress = parseAddress(
    optionOrEnv(parsed, 'strategy-bot-address', 'BOT_ADDRESS'),
    'strategy-bot-address'
  );
  const factoryAddress = parseAddress(
    optionOrEnv(parsed, 'factory-address', 'CLAW_FUND_FACTORY_ADDRESS'),
    'factory-address'
  );
  const aaAddress = parseAddress(
    optionOrEnv(parsed, 'strategy-aa-account-address', 'STRATEGY_AA_ACCOUNT_ADDRESS'),
    'strategy-aa-account-address'
  );
  const submit = parsed.flags.has('submit');
  const skipRelayerSync = parsed.flags.has('skip-relayer-sync');
  const skipGasCheck = parsed.flags.has('skip-gas-check');
  const strategyPolicyUri = parsed.options.get('strategy-policy-uri');
  const telegramRoomId = parsed.options.get('telegram-room-id');
  const telegramHandle = parsed.options.get('telegram-handle');

  const deployConfigInline = parsed.options.get('deploy-config-json');
  const deployConfigFile = parsed.options.get('deploy-config-file');
  if (!deployConfigInline && !deployConfigFile) {
    throw new Error('either --deploy-config-json or --deploy-config-file is required');
  }

  let deployConfigJson = deployConfigInline ?? '';
  if (!deployConfigJson && deployConfigFile) {
    deployConfigJson = await readFile(deployConfigFile, 'utf8');
  }
  const deployConfig = parseDeployConfig(deployConfigJson, strategyBotAddress);
  if (deployConfig.strategyAgent.toLowerCase() !== strategyBotAddress.toLowerCase()) {
    throw new Error(
      `deployConfig.strategyAgent must match strategy-bot-address: strategyAgent=${deployConfig.strategyAgent}, strategyBotAddress=${strategyBotAddress}`
    );
  }
  const intentThresholdWeight = optionBigInt(parsed, 'intent-threshold-weight');
  if (intentThresholdWeight !== undefined) {
    deployConfig.intentThresholdWeight = intentThresholdWeight;
  }

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

  const simulation = await publicClient.simulateContract({
    account: aaAddress,
    address: factoryAddress,
    abi: FUND_FACTORY_ABI,
    functionName: 'createFund',
    args: [deployConfig]
  });
  const [simFundId, simIntentBookAddress, simClawCoreAddress, simClawVaultAddress] =
    simulation.result;

  const aaBalance = await publicClient.getBalance({ address: aaAddress });
  const minAaBalanceWei = optionBigIntOrEnv(
    parsed,
    'min-aa-balance-wei',
    'STRATEGY_CREATE_MIN_AA_BALANCE_WEI',
    DEFAULT_MIN_AA_BALANCE_WEI
  );
  const aaBalanceSufficient = aaBalance >= minAaBalanceWei;

  if (!submit) {
    console.log(
      jsonStringify({
        status: 'OK',
        command: 'strategy-create-fund',
        mode: 'DRY_RUN',
        fundId,
        fundName,
        strategyBotId,
        strategyBotAddress,
        chainId: Math.trunc(chainId),
        factoryAddress,
        simulation: {
          fundId: simFundId,
          intentBookAddress: simIntentBookAddress,
          clawCoreAddress: simClawCoreAddress,
          clawVaultAddress: simClawVaultAddress
        },
        aaPreflight: {
          aaAddress,
          aaBalanceWei: aaBalance,
          minAaBalanceWei,
          sufficient: aaBalanceSufficient
        }
      })
    );
    return;
  }

  if (!aaBalanceSufficient && !skipGasCheck) {
    throw new Error(
      `strategy AA balance too low: balanceWei=${aaBalance.toString()} < minAaBalanceWei=${minAaBalanceWei.toString()} (top up AA or use --skip-gas-check)`
    );
  }

  const aa = StrategyAaClient.fromEnv({
    smartAccount: aaAddress
  });
  const data = encodeFunctionData({
    abi: FUND_FACTORY_ABI,
    functionName: 'createFund',
    args: [deployConfig]
  });

  const userOp = await aa.sendExecute({
    target: factoryAddress,
    data
  });
  if (!userOp.transactionHash) {
    throw new Error('missing transactionHash in user operation receipt');
  }

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: userOp.transactionHash
  });
  if (receipt.status !== 'success') {
    throw new Error(`createFund transaction reverted: ${userOp.transactionHash}`);
  }

  const event = extractFundDeployedLog(
    receipt.logs as Array<{
      address: Address;
      data: Hex;
      topics: readonly Hex[];
    }>,
    factoryAddress
  );
  if (!event) {
    throw new Error('FundDeployed event not found in createFund tx receipt');
  }
  if (event.strategyAgent.toLowerCase() !== strategyBotAddress.toLowerCase()) {
    throw new Error(
      `strategyAgent mismatch: event=${event.strategyAgent} expected=${strategyBotAddress}`
    );
  }

  let relayerSyncResult: Record<string, unknown> | null = null;
  if (!skipRelayerSync) {
    const relayer = createRelayerClient();
    relayerSyncResult = await relayer.syncFundDeployment({
      fundId,
      fundName,
      strategyBotId,
      strategyBotAddress,
      txHash: userOp.transactionHash,
      verifierThresholdWeight: optionBigInt(parsed, 'verifier-threshold-weight'),
      intentThresholdWeight: deployConfig.intentThresholdWeight,
      strategyPolicyUri,
      telegramRoomId,
      telegramHandle
    });
  }

  console.log(
    jsonStringify({
      status: 'OK',
      command: 'strategy-create-fund',
      mode: 'SUBMIT',
      fundId,
      fundName,
      strategyBotId,
      strategyBotAddress,
      userOpHash: userOp.userOpHash,
      txHash: userOp.transactionHash,
      blockNumber: receipt.blockNumber,
      onchainDeployment: {
        fundId: event.fundId,
        fundOwner: event.fundOwner,
        strategyAgent: event.strategyAgent,
        snapshotBookAddress: event.snapshotBookAddress,
        assetAddress: event.assetAddress,
        intentBookAddress: event.intentBookAddress,
        clawCoreAddress: event.clawCoreAddress,
        clawVaultAddress: event.clawVaultAddress
      },
      relayerSync: skipRelayerSync ? 'skipped' : 'submitted',
      relayerSyncResult
    })
  );
};

const runStrategySetAa = async (parsed: ParsedCli): Promise<void> => {
  const address = parseAddress(requiredOption(parsed, 'address'), 'address');
  const envFile =
    parsed.options.get('env-file') ??
    process.env.STRATEGY_AA_ENV_FILE ??
    DEFAULT_AGENTS_ENV_PATH;
  const alsoBotAddress = parsed.flags.has('also-bot-address');

  await upsertEnvValue(envFile, 'STRATEGY_AA_ACCOUNT_ADDRESS', address);
  if (alsoBotAddress) {
    await upsertEnvValue(envFile, 'BOT_ADDRESS', address);
  }

  console.log(
    jsonStringify({
      status: 'OK',
      command: 'strategy-set-aa',
      envFile,
      strategyAaAccountAddress: address,
      updatedKeys: alsoBotAddress
        ? ['STRATEGY_AA_ACCOUNT_ADDRESS', 'BOT_ADDRESS']
        : ['STRATEGY_AA_ACCOUNT_ADDRESS']
    })
  );
};

const printUsage = (): void => {
  console.log(`
[agents] strategy commands

strategy-attest-onchain
  --fund-id <id> --intent-hash <0x...> [--intent-book-address <0x...>]
  [--strategy-aa-account-address <0x...>] [--expiry-safety-seconds <n>] [--skip-relayer-ack]

strategy-execute-ready
  --fund-id <id> [--core-address <0x...>] [--strategy-aa-account-address <0x...>]
  [--limit <n>] [--offset <n>]
  [--retry-delay-ms <n>] [--skip-relayer-ack]

strategy-create-fund
  --fund-id <id> --fund-name <name>
  [--strategy-bot-id <id>] [--strategy-bot-address <0x...>]
  [--factory-address <0x...>] [--strategy-aa-account-address <0x...>]
  [--deploy-config-json '<json>'] [--deploy-config-file <path>]
  [--telegram-room-id <id>] [--strategy-policy-uri <uri>] [--telegram-handle <handle>]
  [--verifier-threshold-weight <n>] [--intent-threshold-weight <n>]
  [--min-aa-balance-wei <wei>] [--submit] [--skip-gas-check] [--skip-relayer-sync]

strategy-set-aa
  --address <0x...> [--env-file <path>] [--also-bot-address]
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
  if (command === 'strategy-create-fund') {
    await runStrategyCreateFund(parsed);
    return true;
  }
  if (command === 'strategy-set-aa') {
    await runStrategySetAa(parsed);
    return true;
  }

  throw new Error(`unknown strategy command: ${command}`);
};
