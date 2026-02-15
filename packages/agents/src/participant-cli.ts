import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
  type Address,
  type Hex
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { RelayerClientOptions } from './lib/relayer-client.js';
import {
  proposeAllocation,
  submitAllocation,
  validateAllocationOrIntent,
  type ProposeAllocationObservation
} from './skills/participant/index.js';

const VAULT_ABI = parseAbi([
  'function deposit(uint256 assets, address receiver) payable returns (uint256 shares)',
  'function depositNative(address receiver) payable returns (uint256 shares)',
  'function withdraw(uint256 assets, address receiver, address owner_) returns (uint256 shares)',
  'function withdrawNative(uint256 assets, address receiver, address owner_) returns (uint256 shares)',
  'function redeem(uint256 shares, address receiver, address owner_) returns (uint256 assets)',
  'function balanceOf(address) view returns (uint256)',
  'function totalAssets() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function sharePriceX18() view returns (uint256)',
  'function previewDeposit(uint256 assets) view returns (uint256)',
  'function previewWithdraw(uint256 assets) view returns (uint256)',
  'function previewRedeem(uint256 shares) view returns (uint256)',
  'function convertToAssets(uint256 shares) view returns (uint256)',
  'function convertToShares(uint256 assets) view returns (uint256)',
  'function userPerformance(address) view returns (uint256 shares, uint256 assetValue, uint256 principal, int256 pnl, uint256 ppsX18)',
  'function asset() view returns (address)',
  'function hasOpenPositions() view returns (bool)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function maxDeposit(address) view returns (uint256)',
  'function maxWithdraw(address) view returns (uint256)',
  'function maxRedeem(address) view returns (uint256)'
]);

const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
]);

const DEFAULT_MIN_SIGNER_BALANCE_WEI = 10_000_000_000_000_000n; // 0.01 MON

interface ParsedCli {
  command?: string;
  options: Map<string, string>;
  flags: Set<string>;
}

const parseCli = (argv: string[]): ParsedCli => {
  const [command, ...rest] = argv;
  const options = new Map<string, string>();
  const flags = new Set<string>();

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith('--')) {
      continue;
    }
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

const optionOrDefault = (
  parsed: ParsedCli,
  key: string,
  fallback: string
): string => {
  return parsed.options.get(key) ?? fallback;
};

const toNumberOption = (
  parsed: ParsedCli,
  key: string,
  fallback: number
): number => {
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

const writeJsonFile = async (
  filePath: string,
  payload: unknown
): Promise<void> => {
  const absolute = resolve(filePath);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, jsonStringify(payload));
};

const readJsonFile = async <T>(filePath: string): Promise<T> => {
  const absolute = resolve(filePath);
  const raw = await readFile(absolute, 'utf8');
  return JSON.parse(raw) as T;
};

const buildClientOptionsForPrefix = (prefix: string): RelayerClientOptions | undefined => {
  const botId = process.env[`${prefix}_BOT_ID`];
  const privateKey = process.env[`${prefix}_PRIVATE_KEY`];
  const botAddress =
    process.env[`${prefix}_ADDRESS`] ?? process.env[`${prefix}_BOT_ADDRESS`];

  if (!botId && !privateKey && !botAddress) {
    return undefined;
  }
  if (!botId || !privateKey) {
    throw new Error(
      `${prefix}_BOT_ID and ${prefix}_PRIVATE_KEY must be set together`
    );
  }

  return {
    botId,
    privateKey: privateKey as `0x${string}`,
    botAddress: botAddress as `0x${string}` | undefined
  };
};

const buildDefaultBotClientOptions = (): RelayerClientOptions | undefined => {
  const botId = process.env.BOT_ID;
  const privateKey = process.env.PARTICIPANT_PRIVATE_KEY;
  const botAddress =
    process.env.PARTICIPANT_ADDRESS ?? process.env.PARTICIPANT_BOT_ADDRESS;

  if (!botId && !privateKey && !botAddress) {
    return undefined;
  }
  if (!botId || !privateKey) {
    throw new Error('BOT_ID and PARTICIPANT_PRIVATE_KEY must be set together');
  }

  return {
    botId,
    privateKey: privateKey as `0x${string}`,
    botAddress: botAddress as `0x${string}` | undefined
  };
};

const buildParticipantClientOptions = (): RelayerClientOptions | undefined => {
  const scoped = buildClientOptionsForPrefix('PARTICIPANT');
  if (scoped) {
    return scoped;
  }
  return buildDefaultBotClientOptions();
};

const parseTargetWeights = (raw: string): Array<string | number | bigint> => {
  const tokens = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    throw new Error('--target-weights must contain at least one integer');
  }
  return tokens.map((token) => {
    try {
      return BigInt(token);
    } catch {
      throw new Error(`invalid target weight: ${token}`);
    }
  });
};

const optionOrEnv = (parsed: ParsedCli, key: string, envName: string): string => {
  const option = parsed.options.get(key);
  if (option) return option;
  const env = process.env[envName];
  if (env) return env;
  throw new Error(`--${key} or ${envName} is required`);
};

const parseAddress = (raw: string, label: string): Address => {
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) {
    throw new Error(`${label} must be a valid 0x-prefixed address: ${raw}`);
  }
  return raw as Address;
};

const participantPrivateKey = (): Hex => {
  const raw = process.env.PARTICIPANT_PRIVATE_KEY ?? '';
  if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error('PARTICIPANT_PRIVATE_KEY is required and must be a 32-byte hex private key');
  }
  return raw as Hex;
};

const participantRuntime = (): {
  chainId: number;
  rpcUrl: string;
  chain: ReturnType<typeof defineChain>;
} => {
  const chainIdRaw = Number(process.env.CHAIN_ID ?? '10143');
  if (!Number.isFinite(chainIdRaw) || chainIdRaw <= 0) {
    throw new Error('CHAIN_ID must be a positive number');
  }
  const rpcUrl = process.env.RPC_URL ?? '';
  if (!rpcUrl) {
    throw new Error('RPC_URL is required');
  }
  const chainId = Math.trunc(chainIdRaw);
  const chain = defineChain({
    id: chainId,
    name: `participant-signer-${chainId}`,
    nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
    rpcUrls: {
      default: { http: [rpcUrl] },
      public: { http: [rpcUrl] }
    }
  });
  return { chainId, rpcUrl, chain };
};

const participantSignerClients = () => {
  const { chainId, rpcUrl, chain } = participantRuntime();
  const account = privateKeyToAccount(participantPrivateKey());
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });
  return { chainId, rpcUrl, account, publicClient, walletClient };
};

const observationToClaimPayload = (
  observation: ProposeAllocationObservation
): Record<string, unknown> => {
  return observation.canonicalClaim as unknown as Record<string, unknown>;
};

const readObservationFromFile = async (
  claimFile: string
): Promise<{ fundId: string; epochId: number; observation: ProposeAllocationObservation }> => {
  const parsed = await readJsonFile<Record<string, unknown>>(claimFile);
  if (parsed.observation) {
    const observation = parsed.observation as ProposeAllocationObservation;
    const fundId = String(parsed.fundId ?? '');
    const epochId = Number(parsed.epochId ?? 0);
    if (!fundId || !Number.isFinite(epochId)) {
      throw new Error('claim file is missing fundId/epochId');
    }
    return { fundId, epochId: Math.trunc(epochId), observation };
  }
  if (parsed.claimHash && parsed.canonicalClaim) {
    const observation = parsed as unknown as ProposeAllocationObservation;
    const fundId = String(parsed.fundId ?? '');
    const epochId = Number(parsed.epochId ?? 0);
    if (!fundId || !Number.isFinite(epochId)) {
      throw new Error('observation file is missing fundId/epochId');
    }
    return { fundId, epochId: Math.trunc(epochId), observation };
  }
  throw new Error('unsupported claim file format');
};

const runParticipantProposeAllocation = async (parsed: ParsedCli): Promise<void> => {
  const fundId = requiredOption(parsed, 'fund-id');
  const epochId = Number(requiredOption(parsed, 'epoch-id'));
  if (!Number.isFinite(epochId)) {
    throw new Error('--epoch-id must be a number');
  }

  const output = await proposeAllocation({
    taskType: 'propose_allocation',
    fundId,
    roomId: optionOrDefault(parsed, 'room-id', 'participant-room'),
    epochId: Math.trunc(epochId),
    allocation: {
      participant: parsed.options.get('participant'),
      targetWeights: parseTargetWeights(requiredOption(parsed, 'target-weights')),
      horizonSec: toNumberOption(parsed, 'horizon-sec', 3600),
      nonce: parsed.options.has('nonce')
        ? toNumberOption(parsed, 'nonce', Math.trunc(Date.now() / 1000))
        : undefined
    }
  });

  console.log(jsonStringify(output));
  const outFile = parsed.options.get('out-file');
  if (outFile) {
    await writeJsonFile(outFile, output);
  }
  if (output.status !== 'OK') {
    process.exitCode = 2;
  }
};

const runParticipantSubmitAllocation = async (parsed: ParsedCli): Promise<void> => {
  const claimFile = requiredOption(parsed, 'claim-file');
  const bundle = await readObservationFromFile(claimFile);
  const submitRequested = parsed.flags.has('submit');

  const validation = await validateAllocationOrIntent({
    taskType: 'validate_allocation_or_intent',
    fundId: bundle.fundId,
    roomId: optionOrDefault(parsed, 'room-id', 'participant-room'),
    epochId: bundle.epochId,
    subjectType: 'CLAIM',
    subjectHash: bundle.observation.claimHash,
    subjectPayload: observationToClaimPayload(bundle.observation),
    validationPolicy: {
      reproducible: true,
      maxDataAgeSeconds: toNumberOption(parsed, 'max-data-age-seconds', 300)
    }
  });

  if (validation.verdict !== 'PASS') {
    console.log(jsonStringify({
      status: 'VALIDATION_FAILED',
      command: 'participant-submit-allocation',
      validation
    }));
    process.exitCode = 2;
    return;
  }

  if (!submitRequested) {
    console.log(jsonStringify({
      status: 'OK',
      command: 'participant-submit-allocation',
      mode: 'DRY_RUN',
      validation,
      fundId: bundle.fundId,
      epochId: bundle.epochId,
      claimHash: bundle.observation.claimHash,
      message: 'validation passed; pass --submit to send to relayer'
    }));
    return;
  }

  const output = await submitAllocation({
    fundId: bundle.fundId,
    epochId: bundle.epochId,
    observation: bundle.observation,
    clientOptions: buildParticipantClientOptions(),
    submit: true
  });

  console.log(jsonStringify({
    ...output,
    command: 'participant-submit-allocation',
    mode: 'SUBMIT',
    validation
  }));

  if (output.status !== 'OK') {
    process.exitCode = 2;
  }
};

const runParticipantDeposit = async (parsed: ParsedCli): Promise<void> => {
  const vaultAddress = parseAddress(
    optionOrEnv(parsed, 'vault-address', 'CLAW_VAULT_ADDRESS'),
    'vault-address'
  );
  const amountRaw = requiredOption(parsed, 'amount');
  const amount = BigInt(amountRaw);
  if (amount <= 0n) throw new Error('--amount must be positive');

  const isNative = parsed.flags.has('native');
  const submit = parsed.flags.has('submit');
  const skipGasCheck = parsed.flags.has('skip-gas-check');

  const { account, publicClient, walletClient } = participantSignerClients();

  const receiverRaw = parsed.options.get('receiver') ?? account.address;
  const receiver = parseAddress(receiverRaw, 'receiver');

  const [signerBalance, hasOpenPositions, assetAddress] = await Promise.all([
    publicClient.getBalance({ address: account.address }),
    publicClient.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: 'hasOpenPositions' }),
    publicClient.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: 'asset' })
  ]);

  if (hasOpenPositions) {
    throw new Error('vault has open positions; deposits are blocked until all positions are closed');
  }

  const minBal = DEFAULT_MIN_SIGNER_BALANCE_WEI;
  if (!skipGasCheck && signerBalance < minBal + (isNative ? amount : 0n)) {
    throw new Error(
      `signer balance too low: ${signerBalance.toString()} wei (need at least ${(minBal + (isNative ? amount : 0n)).toString()} wei)`
    );
  }

  let needsApproval = false;
  let tokenBalance = 0n;
  let currentAllowance = 0n;

  if (!isNative) {
    [tokenBalance, currentAllowance] = await Promise.all([
      publicClient.readContract({ address: assetAddress, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] }),
      publicClient.readContract({ address: assetAddress, abi: ERC20_ABI, functionName: 'allowance', args: [account.address, vaultAddress] })
    ]);

    if (tokenBalance < amount) {
      throw new Error(`insufficient token balance: have=${tokenBalance.toString()}, need=${amount.toString()}`);
    }
    needsApproval = currentAllowance < amount;
  }

  const previewShares = await publicClient.readContract({
    address: vaultAddress,
    abi: VAULT_ABI,
    functionName: 'previewDeposit',
    args: [amount]
  });

  if (!submit) {
    console.log(jsonStringify({
      status: 'OK',
      command: 'participant-deposit',
      mode: 'DRY_RUN',
      vaultAddress,
      receiver,
      amount: amount.toString(),
      isNative,
      previewShares: previewShares.toString(),
      needsApproval,
      signerAddress: account.address,
      signerBalanceWei: signerBalance.toString(),
      assetAddress,
      tokenBalance: isNative ? undefined : tokenBalance.toString(),
      currentAllowance: isNative ? undefined : currentAllowance.toString()
    }));
    return;
  }

  if (!isNative && needsApproval) {
    const approveSim = await publicClient.simulateContract({
      account,
      address: assetAddress,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [vaultAddress, amount]
    });
    const approveTx = await walletClient.writeContract(approveSim.request);
    await publicClient.waitForTransactionReceipt({ hash: approveTx });
  }

  const simulation = isNative
    ? await publicClient.simulateContract({
        account,
        address: vaultAddress,
        abi: VAULT_ABI,
        functionName: 'deposit',
        args: [0n, receiver],
        value: amount
      })
    : await publicClient.simulateContract({
        account,
        address: vaultAddress,
        abi: VAULT_ABI,
        functionName: 'deposit',
        args: [amount, receiver]
      });

  const txHash = await walletClient.writeContract(simulation.request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  if (receipt.status !== 'success') {
    throw new Error(`deposit transaction reverted: ${txHash}`);
  }

  const sharesAfter = await publicClient.readContract({
    address: vaultAddress,
    abi: VAULT_ABI,
    functionName: 'balanceOf',
    args: [receiver]
  });

  console.log(jsonStringify({
    status: 'OK',
    command: 'participant-deposit',
    mode: 'SUBMIT',
    vaultAddress,
    receiver,
    amount: amount.toString(),
    isNative,
    txHash,
    blockNumber: receipt.blockNumber,
    sharesAfter: sharesAfter.toString()
  }));
};

const runParticipantWithdraw = async (parsed: ParsedCli): Promise<void> => {
  const vaultAddress = parseAddress(
    optionOrEnv(parsed, 'vault-address', 'CLAW_VAULT_ADDRESS'),
    'vault-address'
  );
  const amountRaw = requiredOption(parsed, 'amount');
  const amount = BigInt(amountRaw);
  if (amount <= 0n) throw new Error('--amount must be positive');

  const isNative = parsed.flags.has('native');
  const submit = parsed.flags.has('submit');

  const { account, publicClient, walletClient } = participantSignerClients();

  const receiverRaw = parsed.options.get('receiver') ?? account.address;
  const receiver = parseAddress(receiverRaw, 'receiver');

  const [hasOpenPositions, userShares, maxWithdrawable] = await Promise.all([
    publicClient.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: 'hasOpenPositions' }),
    publicClient.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: 'balanceOf', args: [account.address] }),
    publicClient.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: 'maxWithdraw', args: [account.address] })
  ]);

  if (hasOpenPositions) {
    throw new Error('vault has open positions; withdrawals are blocked until all positions are closed');
  }
  if (amount > maxWithdrawable) {
    throw new Error(`withdraw amount exceeds max: requested=${amount.toString()}, max=${maxWithdrawable.toString()}`);
  }

  const previewShares = await publicClient.readContract({
    address: vaultAddress,
    abi: VAULT_ABI,
    functionName: 'previewWithdraw',
    args: [amount]
  });

  if (!submit) {
    console.log(jsonStringify({
      status: 'OK',
      command: 'participant-withdraw',
      mode: 'DRY_RUN',
      vaultAddress,
      receiver,
      amount: amount.toString(),
      isNative,
      previewSharesBurned: previewShares.toString(),
      currentShares: userShares.toString(),
      maxWithdrawable: maxWithdrawable.toString(),
      signerAddress: account.address
    }));
    return;
  }

  const fnName = isNative ? 'withdrawNative' : 'withdraw';
  const simulation = await publicClient.simulateContract({
    account,
    address: vaultAddress,
    abi: VAULT_ABI,
    functionName: fnName,
    args: [amount, receiver, account.address]
  });

  const txHash = await walletClient.writeContract(simulation.request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  if (receipt.status !== 'success') {
    throw new Error(`withdraw transaction reverted: ${txHash}`);
  }

  const sharesAfter = await publicClient.readContract({
    address: vaultAddress,
    abi: VAULT_ABI,
    functionName: 'balanceOf',
    args: [account.address]
  });

  console.log(jsonStringify({
    status: 'OK',
    command: 'participant-withdraw',
    mode: 'SUBMIT',
    vaultAddress,
    receiver,
    amount: amount.toString(),
    isNative,
    txHash,
    blockNumber: receipt.blockNumber,
    sharesAfter: sharesAfter.toString()
  }));
};

const runParticipantRedeem = async (parsed: ParsedCli): Promise<void> => {
  const vaultAddress = parseAddress(
    optionOrEnv(parsed, 'vault-address', 'CLAW_VAULT_ADDRESS'),
    'vault-address'
  );
  const sharesRaw = requiredOption(parsed, 'shares');
  const shares = BigInt(sharesRaw);
  if (shares <= 0n) throw new Error('--shares must be positive');

  const submit = parsed.flags.has('submit');

  const { account, publicClient, walletClient } = participantSignerClients();

  const receiverRaw = parsed.options.get('receiver') ?? account.address;
  const receiver = parseAddress(receiverRaw, 'receiver');

  const [hasOpenPositions, userShares, maxRedeemable] = await Promise.all([
    publicClient.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: 'hasOpenPositions' }),
    publicClient.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: 'balanceOf', args: [account.address] }),
    publicClient.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: 'maxRedeem', args: [account.address] })
  ]);

  if (hasOpenPositions) {
    throw new Error('vault has open positions; redemptions are blocked until all positions are closed');
  }
  if (shares > maxRedeemable) {
    throw new Error(`redeem shares exceeds max: requested=${shares.toString()}, max=${maxRedeemable.toString()}`);
  }

  const previewAssets = await publicClient.readContract({
    address: vaultAddress,
    abi: VAULT_ABI,
    functionName: 'previewRedeem',
    args: [shares]
  });

  if (!submit) {
    console.log(jsonStringify({
      status: 'OK',
      command: 'participant-redeem',
      mode: 'DRY_RUN',
      vaultAddress,
      receiver,
      shares: shares.toString(),
      previewAssetsOut: previewAssets.toString(),
      currentShares: userShares.toString(),
      maxRedeemable: maxRedeemable.toString(),
      signerAddress: account.address
    }));
    return;
  }

  const simulation = await publicClient.simulateContract({
    account,
    address: vaultAddress,
    abi: VAULT_ABI,
    functionName: 'redeem',
    args: [shares, receiver, account.address]
  });

  const txHash = await walletClient.writeContract(simulation.request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  if (receipt.status !== 'success') {
    throw new Error(`redeem transaction reverted: ${txHash}`);
  }

  const sharesAfter = await publicClient.readContract({
    address: vaultAddress,
    abi: VAULT_ABI,
    functionName: 'balanceOf',
    args: [account.address]
  });

  console.log(jsonStringify({
    status: 'OK',
    command: 'participant-redeem',
    mode: 'SUBMIT',
    vaultAddress,
    receiver,
    shares: shares.toString(),
    txHash,
    blockNumber: receipt.blockNumber,
    sharesAfter: sharesAfter.toString()
  }));
};

const runParticipantVaultInfo = async (parsed: ParsedCli): Promise<void> => {
  const vaultAddress = parseAddress(
    optionOrEnv(parsed, 'vault-address', 'CLAW_VAULT_ADDRESS'),
    'vault-address'
  );

  const { chain } = participantRuntime();
  const rpcUrl = process.env.RPC_URL ?? '';
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

  const accountRaw = parsed.options.get('account')
    ?? process.env.PARTICIPANT_ADDRESS
    ?? process.env.PARTICIPANT_BOT_ADDRESS;

  const [vaultName, vaultSymbol, totalAssets, totalSupply, ppsX18, hasOpenPositions, assetAddress] = await Promise.all([
    publicClient.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: 'name' }),
    publicClient.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: 'symbol' }),
    publicClient.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: 'totalAssets' }),
    publicClient.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: 'totalSupply' }),
    publicClient.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: 'sharePriceX18' }),
    publicClient.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: 'hasOpenPositions' }),
    publicClient.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: 'asset' })
  ]);

  let userInfo: Record<string, unknown> | undefined;
  if (accountRaw) {
    const userAddress = parseAddress(accountRaw, 'account');
    const [shares, assetValue, principal, pnl, userPps] = await publicClient.readContract({
      address: vaultAddress,
      abi: VAULT_ABI,
      functionName: 'userPerformance',
      args: [userAddress]
    });

    userInfo = {
      address: userAddress,
      shares: shares.toString(),
      assetValue: assetValue.toString(),
      principal: principal.toString(),
      pnl: pnl.toString(),
      sharePriceX18: userPps.toString()
    };
  }

  console.log(jsonStringify({
    status: 'OK',
    command: 'participant-vault-info',
    vault: {
      address: vaultAddress,
      name: vaultName,
      symbol: vaultSymbol,
      asset: assetAddress,
      totalAssets: totalAssets.toString(),
      totalSupply: totalSupply.toString(),
      sharePriceX18: ppsX18.toString(),
      hasOpenPositions
    },
    user: userInfo ?? null
  }));
};

const printUsage = (): void => {
  console.log(`
[agents] participant commands

participant-propose-allocation
  --fund-id <id> --epoch-id <n> --target-weights <w1,w2,...>
  [--participant <0x...>] [--horizon-sec <n>] [--nonce <n>] [--room-id <id>] [--out-file <path>]

participant-submit-allocation
  --claim-file <path> [--max-data-age-seconds <n>] [--submit]
  validates claim hash first; without --submit shows dry-run, with --submit sends to relayer

participant-deposit
  --amount <wei> [--vault-address <0x...>] [--receiver <0x...>] [--native] [--submit]
  [--skip-gas-check]

participant-withdraw
  --amount <wei> [--vault-address <0x...>] [--receiver <0x...>] [--native] [--submit]

participant-redeem
  --shares <wei> [--vault-address <0x...>] [--receiver <0x...>] [--submit]

participant-vault-info
  [--vault-address <0x...>] [--account <0x...>]
`);
};

export const runParticipantCli = async (argv: string[]): Promise<boolean> => {
  const parsed = parseCli(argv);
  const command = parsed.command ?? '';
  if (!command.startsWith('participant-')) {
    return false;
  }

  if (parsed.flags.has('help') || command === 'participant-help') {
    printUsage();
    return true;
  }

  if (command === 'participant-propose-allocation') {
    await runParticipantProposeAllocation(parsed);
    return true;
  }
  if (command === 'participant-submit-allocation') {
    await runParticipantSubmitAllocation(parsed);
    return true;
  }
  if (command === 'participant-deposit') {
    await runParticipantDeposit(parsed);
    return true;
  }
  if (command === 'participant-withdraw') {
    await runParticipantWithdraw(parsed);
    return true;
  }
  if (command === 'participant-redeem') {
    await runParticipantRedeem(parsed);
    return true;
  }
  if (command === 'participant-vault-info') {
    await runParticipantVaultInfo(parsed);
    return true;
  }

  throw new Error(`unknown participant command: ${command}`);
};
