import {
  concatHex,
  createPublicClient,
  defineChain,
  encodeFunctionData,
  http,
  padHex,
  parseAbi,
  toHex,
  type Address,
  type Hex
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const ENTRYPOINT_ABI = parseAbi([
  'function getNonce(address sender, uint192 key) view returns (uint256)',
  'function getUserOpHash((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp) view returns (bytes32)'
]);

const SIMPLE_ACCOUNT_ABI = parseAbi([
  'function execute(address dest, uint256 value, bytes data)'
]);

interface UserOperationForHash {
  sender: Address;
  nonce: bigint;
  initCode: Hex;
  callData: Hex;
  accountGasLimits: Hex;
  preVerificationGas: bigint;
  gasFees: Hex;
  paymasterAndData: Hex;
  signature: Hex;
}

interface RpcUserOperation {
  sender: Address;
  nonce: Hex;
  initCode: Hex;
  callData: Hex;
  accountGasLimits: Hex;
  preVerificationGas: Hex;
  gasFees: Hex;
  paymasterAndData: Hex;
  signature: Hex;
}

interface JsonRpcSuccess<T> {
  jsonrpc: '2.0';
  id: number;
  result: T;
}

interface JsonRpcFailure {
  jsonrpc: '2.0';
  id: number;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

type JsonRpcResponse<T> = JsonRpcSuccess<T> | JsonRpcFailure;

export interface StrategyAaClientConfig {
  chainId: number;
  rpcUrl: string;
  bundlerUrl: string;
  entryPoint: Address;
  smartAccount: Address;
  ownerPrivateKey: Hex;
  initCode?: Hex;
  callGasLimit?: bigint;
  verificationGasLimit?: bigint;
  preVerificationGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  maxFeePerGas?: bigint;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface ExecuteViaAaInput {
  target: Address;
  data: Hex;
  value?: bigint;
}

export interface UserOperationResult {
  userOpHash: Hex;
  receipt: Record<string, unknown> | null;
  transactionHash: Hex | null;
}

const DEFAULT_CALL_GAS_LIMIT = 400_000n;
const DEFAULT_VERIFICATION_GAS_LIMIT = 300_000n;
const DEFAULT_PRE_VERIFICATION_GAS = 60_000n;
const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_TIMEOUT_MS = 120_000;

const toU128Hex = (value: bigint): Hex => {
  if (value < 0n) {
    throw new Error('u128 value must be non-negative');
  }
  return padHex(toHex(value), { size: 16 });
};

const packU128 = (left: bigint, right: bigint): Hex => {
  return concatHex([toU128Hex(left), toU128Hex(right)]);
};

export class StrategyAaClient {
  private readonly config: StrategyAaClientConfig;
  private readonly publicClient;
  private readonly owner;

  constructor(config: StrategyAaClientConfig) {
    this.config = config;
    this.owner = privateKeyToAccount(config.ownerPrivateKey);
    const chain = defineChain({
      id: config.chainId,
      name: `strategy-aa-${config.chainId}`,
      nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
      rpcUrls: {
        default: { http: [config.rpcUrl] },
        public: { http: [config.rpcUrl] }
      }
    });
    this.publicClient = createPublicClient({
      chain,
      transport: http(config.rpcUrl)
    });
  }

  static fromEnv(): StrategyAaClient {
    const chainIdRaw = process.env.CHAIN_ID ?? '10143';
    const chainId = Number(chainIdRaw);
    const rpcUrl = process.env.STRATEGY_AA_RPC_URL ?? process.env.RPC_URL ?? '';
    const bundlerUrl = process.env.STRATEGY_AA_BUNDLER_URL ?? '';
    const entryPoint = process.env.STRATEGY_AA_ENTRYPOINT_ADDRESS ?? '';
    const smartAccount = process.env.STRATEGY_AA_ACCOUNT_ADDRESS ?? '';
    const ownerPrivateKey =
      process.env.STRATEGY_AA_OWNER_PRIVATE_KEY ?? process.env.STRATEGY_PRIVATE_KEY ?? '';

    if (!rpcUrl) throw new Error('STRATEGY_AA_RPC_URL (or RPC_URL) is required');
    if (!bundlerUrl) throw new Error('STRATEGY_AA_BUNDLER_URL is required');
    if (!entryPoint) throw new Error('STRATEGY_AA_ENTRYPOINT_ADDRESS is required');
    if (!smartAccount) throw new Error('STRATEGY_AA_ACCOUNT_ADDRESS is required');
    if (!ownerPrivateKey) {
      throw new Error('STRATEGY_AA_OWNER_PRIVATE_KEY (or STRATEGY_PRIVATE_KEY) is required');
    }
    if (!Number.isFinite(chainId) || chainId <= 0) {
      throw new Error('CHAIN_ID must be a positive number');
    }

    const parseBigIntEnv = (name: string): bigint | undefined => {
      const raw = process.env[name];
      if (!raw || raw.trim().length === 0) return undefined;
      return BigInt(raw);
    };

    const parseNumberEnv = (name: string): number | undefined => {
      const raw = process.env[name];
      if (!raw || raw.trim().length === 0) return undefined;
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`${name} must be a positive number`);
      }
      return Math.trunc(value);
    };

    return new StrategyAaClient({
      chainId: Math.trunc(chainId),
      rpcUrl,
      bundlerUrl,
      entryPoint: entryPoint as Address,
      smartAccount: smartAccount as Address,
      ownerPrivateKey: ownerPrivateKey as Hex,
      initCode: (process.env.STRATEGY_AA_INIT_CODE as Hex | undefined) ?? ('0x' as Hex),
      callGasLimit: parseBigIntEnv('STRATEGY_AA_CALL_GAS_LIMIT'),
      verificationGasLimit: parseBigIntEnv('STRATEGY_AA_VERIFICATION_GAS_LIMIT'),
      preVerificationGas: parseBigIntEnv('STRATEGY_AA_PRE_VERIFICATION_GAS'),
      maxPriorityFeePerGas: parseBigIntEnv('STRATEGY_AA_MAX_PRIORITY_FEE_PER_GAS'),
      maxFeePerGas: parseBigIntEnv('STRATEGY_AA_MAX_FEE_PER_GAS'),
      pollIntervalMs: parseNumberEnv('STRATEGY_AA_POLL_INTERVAL_MS'),
      timeoutMs: parseNumberEnv('STRATEGY_AA_TIMEOUT_MS')
    });
  }

  async sendExecute(input: ExecuteViaAaInput): Promise<UserOperationResult> {
    const callData = encodeFunctionData({
      abi: SIMPLE_ACCOUNT_ABI,
      functionName: 'execute',
      args: [input.target, input.value ?? 0n, input.data]
    });
    return this.sendUserOperation(callData);
  }

  async sendUserOperation(callData: Hex): Promise<UserOperationResult> {
    const userOp = await this.buildSignedUserOperation(callData);
    const userOpHash = await this.callBundler<Hex>('eth_sendUserOperation', [
      this.toRpcUserOperation(userOp),
      this.config.entryPoint
    ]);
    const receipt = await this.waitForUserOperationReceipt(userOpHash);
    const maybeTxHash = (receipt as { receipt?: { transactionHash?: unknown } } | null)?.receipt
      ?.transactionHash;
    const transactionHash =
      typeof maybeTxHash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(maybeTxHash)
        ? (maybeTxHash as Hex)
        : null;
    return {
      userOpHash,
      receipt,
      transactionHash
    };
  }

  async waitForUserOperationReceipt(userOpHash: Hex): Promise<Record<string, unknown> | null> {
    const pollIntervalMs = this.config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() <= deadline) {
      const receipt = await this.callBundler<Record<string, unknown> | null>(
        'eth_getUserOperationReceipt',
        [userOpHash]
      );
      if (receipt) {
        return receipt;
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(`UserOperation receipt timeout after ${timeoutMs}ms: ${userOpHash}`);
  }

  private async buildSignedUserOperation(callData: Hex): Promise<UserOperationForHash> {
    const nonce = await this.publicClient.readContract({
      address: this.config.entryPoint,
      abi: ENTRYPOINT_ABI,
      functionName: 'getNonce',
      args: [this.config.smartAccount, 0n]
    });

    let suggestedMaxPriority = this.config.maxPriorityFeePerGas;
    let suggestedMaxFee = this.config.maxFeePerGas;
    if (suggestedMaxPriority === undefined || suggestedMaxFee === undefined) {
      try {
        const fee = await this.publicClient.estimateFeesPerGas();
        const fallback = fee.gasPrice ?? 1n;
        suggestedMaxPriority = suggestedMaxPriority ?? fee.maxPriorityFeePerGas ?? fallback;
        suggestedMaxFee = suggestedMaxFee ?? fee.maxFeePerGas ?? fallback;
      } catch {
        const gasPrice = await this.publicClient.getGasPrice();
        suggestedMaxPriority = suggestedMaxPriority ?? gasPrice;
        suggestedMaxFee = suggestedMaxFee ?? gasPrice;
      }
    }

    const maxPriorityFeePerGas = suggestedMaxPriority;
    const maxFeePerGas = suggestedMaxFee;
    const callGasLimit = this.config.callGasLimit ?? DEFAULT_CALL_GAS_LIMIT;
    const verificationGasLimit = this.config.verificationGasLimit ?? DEFAULT_VERIFICATION_GAS_LIMIT;
    const preVerificationGas = this.config.preVerificationGas ?? DEFAULT_PRE_VERIFICATION_GAS;

    const draft: UserOperationForHash = {
      sender: this.config.smartAccount,
      nonce,
      initCode: this.config.initCode ?? ('0x' as Hex),
      callData,
      accountGasLimits: packU128(verificationGasLimit, callGasLimit),
      preVerificationGas,
      gasFees: packU128(maxPriorityFeePerGas, maxFeePerGas),
      paymasterAndData: '0x',
      signature: '0x'
    };

    const userOpHash = await this.publicClient.readContract({
      address: this.config.entryPoint,
      abi: ENTRYPOINT_ABI,
      functionName: 'getUserOpHash',
      args: [draft]
    });
    const signature = await this.owner.signMessage({
      message: { raw: userOpHash }
    });

    return {
      ...draft,
      signature
    };
  }

  private toRpcUserOperation(userOp: UserOperationForHash): RpcUserOperation {
    return {
      sender: userOp.sender,
      nonce: toHex(userOp.nonce),
      initCode: userOp.initCode,
      callData: userOp.callData,
      accountGasLimits: userOp.accountGasLimits,
      preVerificationGas: toHex(userOp.preVerificationGas),
      gasFees: userOp.gasFees,
      paymasterAndData: userOp.paymasterAndData,
      signature: userOp.signature
    };
  }

  private async callBundler<T>(method: string, params: unknown[]): Promise<T> {
    const payload = {
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params
    };

    const response = await fetch(this.config.bundlerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Bundler request failed (${response.status}): ${response.statusText}`);
    }

    const json = (await response.json()) as JsonRpcResponse<T>;
    if ('error' in json) {
      throw new Error(
        `Bundler RPC error ${json.error.code}: ${json.error.message}${
          json.error.data ? ` (${JSON.stringify(json.error.data)})` : ''
        }`
      );
    }
    return json.result;
  }
}
