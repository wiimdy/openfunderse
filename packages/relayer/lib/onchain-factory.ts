import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  http,
  parseAbi,
  type Log
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "@claw/protocol-sdk";
import { loadFactoryRuntimeConfig } from "@/lib/config";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

const FUND_FACTORY_ABI = parseAbi([
  "function createFund((address fundOwner,address strategyAgent,address snapshotBook,address asset,string vaultName,string vaultSymbol,uint256 intentThresholdWeight,address nadfunLens,address[] initialVerifiers,uint256[] initialVerifierWeights,address[] initialAllowedTokens,address[] initialAllowedAdapters) cfg) returns (uint256 fundId, address intentBook, address core, address vault)",
  "event FundDeployed(uint256 indexed fundId, address indexed fundOwner, address indexed strategyAgent, address intentBook, address core, address vault, address snapshotBook, address asset)"
]);

export interface DeployConfigInput {
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

export interface SimulatedFundCreateResult {
  fundId: bigint;
  intentBookAddress: Address;
  clawCoreAddress: Address;
  clawVaultAddress: Address;
}

export interface FundDeploymentResult extends SimulatedFundCreateResult {
  chainId: bigint;
  factoryAddress: Address;
  txHash: Hex;
  blockNumber: bigint;
  fundOwner: Address;
  strategyAgent: Address;
  snapshotBookAddress: Address;
  assetAddress: Address;
  deployerAddress: Address;
}

function runtimeClients() {
  const cfg = loadFactoryRuntimeConfig();

  const chain = defineChain({
    id: Number(cfg.chainId),
    name: `claw-${cfg.chainId.toString(10)}`,
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: {
      default: { http: [cfg.rpcUrl] },
      public: { http: [cfg.rpcUrl] }
    }
  });

  const account = privateKeyToAccount(cfg.signerKey);
  const publicClient = createPublicClient({ chain, transport: http(cfg.rpcUrl) });
  const walletClient = createWalletClient({ account, chain, transport: http(cfg.rpcUrl) });

  return {
    chainId: cfg.chainId,
    factoryAddress: cfg.factoryAddress,
    publicClient,
    walletClient,
    account
  };
}

function normalizeDeployConfig(input: DeployConfigInput): DeployConfigInput {
  return {
    ...input,
    strategyAgent: input.strategyAgent || ZERO_ADDRESS,
    nadfunLens: input.nadfunLens || ZERO_ADDRESS
  };
}

function extractFundDeployedLog(logs: readonly Log[], factoryAddress: Address) {
  const factory = factoryAddress.toLowerCase();
  for (const log of logs) {
    if (log.address.toLowerCase() !== factory) {
      continue;
    }

    try {
      const decoded = decodeEventLog({
        abi: FUND_FACTORY_ABI,
        data: log.data,
        topics: log.topics,
        strict: false
      });
      if (decoded.eventName !== "FundDeployed") continue;

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
}

export async function simulateCreateFund(
  deployConfigInput: DeployConfigInput
): Promise<SimulatedFundCreateResult> {
  const { publicClient, account, factoryAddress } = runtimeClients();
  const deployConfig = normalizeDeployConfig(deployConfigInput);
  const simulation = await publicClient.simulateContract({
    account,
    address: factoryAddress,
    abi: FUND_FACTORY_ABI,
    functionName: "createFund",
    args: [deployConfig]
  });

  const [fundId, intentBookAddress, clawCoreAddress, clawVaultAddress] = simulation.result;
  return {
    fundId,
    intentBookAddress,
    clawCoreAddress,
    clawVaultAddress
  };
}

export async function createFundOnchain(
  deployConfigInput: DeployConfigInput
): Promise<FundDeploymentResult> {
  const { publicClient, walletClient, account, chainId, factoryAddress } = runtimeClients();
  const deployConfig = normalizeDeployConfig(deployConfigInput);

  const simulation = await publicClient.simulateContract({
    account,
    address: factoryAddress,
    abi: FUND_FACTORY_ABI,
    functionName: "createFund",
    args: [deployConfig]
  });
  const [simFundId, simIntentBookAddress, simClawCoreAddress, simClawVaultAddress] = simulation.result;

  const txHash = await walletClient.writeContract(simulation.request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`createFund tx reverted: ${txHash}`);
  }
  const event = extractFundDeployedLog(receipt.logs, factoryAddress);

  const resolvedStrategyAgent =
    deployConfig.strategyAgent === ZERO_ADDRESS ? deployConfig.fundOwner : deployConfig.strategyAgent;

  return {
    chainId,
    factoryAddress,
    txHash,
    blockNumber: receipt.blockNumber,
    fundId: event?.fundId ?? simFundId,
    intentBookAddress: event?.intentBookAddress ?? simIntentBookAddress,
    clawCoreAddress: event?.clawCoreAddress ?? simClawCoreAddress,
    clawVaultAddress: event?.clawVaultAddress ?? simClawVaultAddress,
    fundOwner: event?.fundOwner ?? deployConfig.fundOwner,
    strategyAgent: event?.strategyAgent ?? resolvedStrategyAgent,
    snapshotBookAddress: event?.snapshotBookAddress ?? deployConfig.snapshotBook,
    assetAddress: event?.assetAddress ?? deployConfig.asset,
    deployerAddress: account.address
  };
}
