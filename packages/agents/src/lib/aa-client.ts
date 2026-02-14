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

const ENTRYPOINT_V07_ABI = parseAbi([
  'function getNonce(address sender, uint192 key) view returns (uint256)',
  'function getUserOpHash((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp) view returns (bytes32)'
]);

const ENTRYPOINT_V06_ABI = parseAbi([
  'function getNonce(address sender, uint192 key) view returns (uint256)',
  'function getUserOpHash((address sender,uint256 nonce,bytes initCode,bytes callData,uint256 callGasLimit,uint256 verificationGasLimit,uint256 preVerificationGas,uint256 maxFeePerGas,uint256 maxPriorityFeePerGas,bytes paymasterAndData,bytes signature) userOp) view returns (bytes32)'
]);

const SIMPLE_ACCOUNT_ABI = parseAbi([
  'function execute(address dest, uint256 value, bytes data)'
]);

type UserOpVersion = 'v06' | 'v07';

interface UserOperationV07ForHash {
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

interface RpcUserOperationV07 {
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

interface UserOperationV06ForHash {
  sender: Address;
  nonce: bigint;
  initCode: Hex;
  callData: Hex;
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  paymasterAndData: Hex;
  signature: Hex;
}

interface RpcUserOperationV06 {
  sender: Address;
  nonce: Hex;
  initCode: Hex;
  callData: Hex;
  callGasLimit: Hex;
  verificationGasLimit: Hex;
  preVerificationGas: Hex;
  maxFeePerGas: Hex;
  maxPriorityFeePerGas: Hex;
  paymasterAndData: Hex;
  signature: Hex;
}

interface BundlerUserOpGasPriceLevel {
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
}

interface BundlerUserOpGasPriceResponse {
  standard?: BundlerUserOpGasPriceLevel;
  fast?: BundlerUserOpGasPriceLevel;
  slow?: BundlerUserOpGasPriceLevel;
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
  userOpVersion?: UserOpVersion;
}

export interface StrategyAaClientEnvOverrides {
  chainId?: number;
  rpcUrl?: string;
  bundlerUrl?: string;
  entryPoint?: Address;
  smartAccount?: Address;
  ownerPrivateKey?: Hex;
  initCode?: Hex;
  callGasLimit?: bigint;
  verificationGasLimit?: bigint;
  preVerificationGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  maxFeePerGas?: bigint;
  pollIntervalMs?: number;
  timeoutMs?: number;
  userOpVersion?: UserOpVersion;
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
const DEFAULT_PRE_VERIFICATION_GAS_V07 = 60_000n;
const DEFAULT_PRE_VERIFICATION_GAS_V06 = 2_000_000n;
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

  static fromEnv(overrides: StrategyAaClientEnvOverrides = {}): StrategyAaClient {
    const chainIdRaw = process.env.CHAIN_ID ?? '10143';
    const envChainId = Number(chainIdRaw);
    const chainId = overrides.chainId ?? envChainId;
    const rpcUrl = overrides.rpcUrl ?? process.env.STRATEGY_AA_RPC_URL ?? process.env.RPC_URL ?? '';
    const bundlerUrl = overrides.bundlerUrl ?? process.env.STRATEGY_AA_BUNDLER_URL ?? '';
    const entryPoint = overrides.entryPoint ?? (process.env.STRATEGY_AA_ENTRYPOINT_ADDRESS as Address | undefined) ?? '';
    const smartAccount = overrides.smartAccount ?? (process.env.STRATEGY_AA_ACCOUNT_ADDRESS as Address | undefined) ?? '';
    const ownerPrivateKey =
      overrides.ownerPrivateKey ??
      (process.env.STRATEGY_AA_OWNER_PRIVATE_KEY as Hex | undefined) ??
      (process.env.STRATEGY_PRIVATE_KEY as Hex | undefined) ??
      '';
    const rawUserOpVersion =
      (overrides.userOpVersion ?? (process.env.STRATEGY_AA_USER_OP_VERSION as UserOpVersion | undefined) ?? 'v07')
        .toLowerCase();
    if (rawUserOpVersion !== 'v06' && rawUserOpVersion !== 'v07') {
      throw new Error('STRATEGY_AA_USER_OP_VERSION must be one of: v06, v07');
    }

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
      initCode:
        overrides.initCode ??
        ((process.env.STRATEGY_AA_INIT_CODE as Hex | undefined) ?? ('0x' as Hex)),
      callGasLimit: overrides.callGasLimit ?? parseBigIntEnv('STRATEGY_AA_CALL_GAS_LIMIT'),
      verificationGasLimit:
        overrides.verificationGasLimit ?? parseBigIntEnv('STRATEGY_AA_VERIFICATION_GAS_LIMIT'),
      preVerificationGas:
        overrides.preVerificationGas ?? parseBigIntEnv('STRATEGY_AA_PRE_VERIFICATION_GAS'),
      maxPriorityFeePerGas:
        overrides.maxPriorityFeePerGas ?? parseBigIntEnv('STRATEGY_AA_MAX_PRIORITY_FEE_PER_GAS'),
      maxFeePerGas: overrides.maxFeePerGas ?? parseBigIntEnv('STRATEGY_AA_MAX_FEE_PER_GAS'),
      pollIntervalMs: overrides.pollIntervalMs ?? parseNumberEnv('STRATEGY_AA_POLL_INTERVAL_MS'),
      timeoutMs: overrides.timeoutMs ?? parseNumberEnv('STRATEGY_AA_TIMEOUT_MS'),
      userOpVersion: rawUserOpVersion as UserOpVersion
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
    if (this.userOpVersion() === 'v06') {
      const userOp = await this.buildSignedUserOperationV06(callData);
      const rpcUserOp = this.toRpcUserOperationV06(userOp);
      return this.submitUserOperation(rpcUserOp);
    }

    const userOp = await this.buildSignedUserOperationV07(callData);
    const rpcUserOp = this.toRpcUserOperationV07(userOp);
    return this.submitUserOperation(rpcUserOp);
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

  private userOpVersion(): UserOpVersion {
    return this.config.userOpVersion ?? 'v07';
  }

  private async submitUserOperation(
    rpcUserOp: RpcUserOperationV07 | RpcUserOperationV06
  ): Promise<UserOperationResult> {
    const userOpHash = await this.callBundler<Hex>('eth_sendUserOperation', [
      rpcUserOp,
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

  private async resolveGasFees(preferBundlerGasRpc: boolean): Promise<{
    maxPriorityFeePerGas: bigint;
    maxFeePerGas: bigint;
  }> {
    let maxPriorityFeePerGas = this.config.maxPriorityFeePerGas;
    let maxFeePerGas = this.config.maxFeePerGas;

    if (preferBundlerGasRpc && (maxPriorityFeePerGas === undefined || maxFeePerGas === undefined)) {
      const bundlerGas = await this.tryResolveBundlerGasFees();
      if (bundlerGas) {
        maxPriorityFeePerGas = maxPriorityFeePerGas ?? bundlerGas.maxPriorityFeePerGas;
        maxFeePerGas = maxFeePerGas ?? bundlerGas.maxFeePerGas;
      }
    }

    if (maxPriorityFeePerGas === undefined || maxFeePerGas === undefined) {
      try {
        const fee = await this.publicClient.estimateFeesPerGas();
        const fallback = fee.gasPrice ?? 1n;
        maxPriorityFeePerGas = maxPriorityFeePerGas ?? fee.maxPriorityFeePerGas ?? fallback;
        maxFeePerGas = maxFeePerGas ?? fee.maxFeePerGas ?? fallback;
      } catch {
        const gasPrice = await this.publicClient.getGasPrice();
        maxPriorityFeePerGas = maxPriorityFeePerGas ?? gasPrice;
        maxFeePerGas = maxFeePerGas ?? gasPrice;
      }
    }

    return { maxPriorityFeePerGas, maxFeePerGas };
  }

  private parseBigIntLike(raw: unknown): bigint | null {
    if (typeof raw === 'bigint') {
      return raw;
    }
    if (typeof raw === 'number') {
      if (!Number.isFinite(raw) || raw < 0) return null;
      return BigInt(Math.trunc(raw));
    }
    if (typeof raw === 'string' && raw.trim().length > 0) {
      try {
        return BigInt(raw);
      } catch {
        return null;
      }
    }
    return null;
  }

  private async tryResolveBundlerGasFees(): Promise<{
    maxPriorityFeePerGas: bigint;
    maxFeePerGas: bigint;
  } | null> {
    try {
      const response = await this.callBundler<BundlerUserOpGasPriceResponse>(
        'pimlico_getUserOperationGasPrice',
        []
      );
      const level = response.standard ?? response.fast ?? response.slow;
      if (!level) return null;
      const maxFeePerGas = this.parseBigIntLike(level.maxFeePerGas);
      const maxPriorityFeePerGas = this.parseBigIntLike(level.maxPriorityFeePerGas);
      if (maxFeePerGas === null || maxPriorityFeePerGas === null) {
        return null;
      }
      return { maxPriorityFeePerGas, maxFeePerGas };
    } catch {
      return null;
    }
  }

  private async buildSignedUserOperationV07(callData: Hex): Promise<UserOperationV07ForHash> {
    const nonce = await this.publicClient.readContract({
      address: this.config.entryPoint,
      abi: ENTRYPOINT_V07_ABI,
      functionName: 'getNonce',
      args: [this.config.smartAccount, 0n]
    });

    const { maxPriorityFeePerGas, maxFeePerGas } = await this.resolveGasFees(false);
    const callGasLimit = this.config.callGasLimit ?? DEFAULT_CALL_GAS_LIMIT;
    const verificationGasLimit = this.config.verificationGasLimit ?? DEFAULT_VERIFICATION_GAS_LIMIT;
    const preVerificationGas =
      this.config.preVerificationGas ?? DEFAULT_PRE_VERIFICATION_GAS_V07;

    const draft: UserOperationV07ForHash = {
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
      abi: ENTRYPOINT_V07_ABI,
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

  private async buildSignedUserOperationV06(callData: Hex): Promise<UserOperationV06ForHash> {
    const nonce = await this.publicClient.readContract({
      address: this.config.entryPoint,
      abi: ENTRYPOINT_V06_ABI,
      functionName: 'getNonce',
      args: [this.config.smartAccount, 0n]
    });

    const { maxPriorityFeePerGas, maxFeePerGas } = await this.resolveGasFees(true);
    const callGasLimit = this.config.callGasLimit ?? DEFAULT_CALL_GAS_LIMIT;
    const verificationGasLimit = this.config.verificationGasLimit ?? DEFAULT_VERIFICATION_GAS_LIMIT;
    const preVerificationGas =
      this.config.preVerificationGas ?? DEFAULT_PRE_VERIFICATION_GAS_V06;

    const draft: UserOperationV06ForHash = {
      sender: this.config.smartAccount,
      nonce,
      initCode: this.config.initCode ?? ('0x' as Hex),
      callData,
      callGasLimit,
      verificationGasLimit,
      preVerificationGas,
      maxFeePerGas,
      maxPriorityFeePerGas,
      paymasterAndData: '0x',
      signature: '0x'
    };

    const userOpHash = await this.publicClient.readContract({
      address: this.config.entryPoint,
      abi: ENTRYPOINT_V06_ABI,
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

  private toRpcUserOperationV07(userOp: UserOperationV07ForHash): RpcUserOperationV07 {
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

  private toRpcUserOperationV06(userOp: UserOperationV06ForHash): RpcUserOperationV06 {
    return {
      sender: userOp.sender,
      nonce: toHex(userOp.nonce),
      initCode: userOp.initCode,
      callData: userOp.callData,
      callGasLimit: toHex(userOp.callGasLimit),
      verificationGasLimit: toHex(userOp.verificationGasLimit),
      preVerificationGas: toHex(userOp.preVerificationGas),
      maxFeePerGas: toHex(userOp.maxFeePerGas),
      maxPriorityFeePerGas: toHex(userOp.maxPriorityFeePerGas),
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
