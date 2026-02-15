#!/usr/bin/env node

import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  http,
  parseAbi
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const FUND_FACTORY_ABI = parseAbi([
  "function createFund((address fundOwner,address strategyAgent,address asset,string vaultName,string vaultSymbol,uint256 intentThresholdWeight,address nadfunLens,address[] initialVerifiers,uint256[] initialVerifierWeights,address[] initialAllowedTokens,address[] initialAllowedAdapters) cfg) returns (uint256 fundId, address intentBook, address core, address vault)",
  "event FundDeployed(uint256 indexed fundId, address indexed fundOwner, address indexed strategyAgent, address intentBook, address core, address vault, address snapshotBook, address asset)"
]);

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env: ${name}`);
  return value;
}

function envOr(name, fallback) {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

function parseAddress(name, value) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`${name} must be a valid 20-byte hex address`);
  }
  return value;
}

function parseBigInt(name, value) {
  try {
    return BigInt(value);
  } catch {
    throw new Error(`${name} must be an integer`);
  }
}

function parseAddressList(name, value) {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry, index) => parseAddress(`${name}[${index}]`, entry));
}

function parseBigIntList(name, value) {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry, index) => parseBigInt(`${name}[${index}]`, entry));
}

function stringify(value) {
  return JSON.stringify(
    value,
    (_, candidate) => (typeof candidate === "bigint" ? candidate.toString() : candidate),
    2
  );
}

function extractEvent(logs) {
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: FUND_FACTORY_ABI,
        data: log.data,
        topics: log.topics,
        strict: false
      });
      if (decoded.eventName !== "FundDeployed") continue;
      const args = decoded.args;
      if (!args) continue;
      return {
        fundId: args.fundId,
        fundOwner: args.fundOwner,
        strategyAgent: args.strategyAgent,
        intentBook: args.intentBook,
        core: args.core,
        vault: args.vault,
        snapshotBook: args.snapshotBook,
        asset: args.asset
      };
    } catch {
      continue;
    }
  }
  return null;
}

async function main() {
  const chainId = Number(env("CHAIN_ID"));
  if (!Number.isFinite(chainId) || chainId <= 0) {
    throw new Error("CHAIN_ID must be a positive number");
  }
  const rpcUrl = env("RPC_URL");
  const signer = envOr("FACTORY_SIGNER_PRIVATE_KEY", env("RELAYER_SIGNER_PRIVATE_KEY"));
  const factoryAddress = parseAddress(
    "CLAW_FUND_FACTORY_ADDRESS",
    env("CLAW_FUND_FACTORY_ADDRESS")
  );

  const fundOwner = parseAddress("FUND_OWNER", env("FUND_OWNER"));
  const strategyAgent = parseAddress(
    "STRATEGY_AGENT",
    envOr("STRATEGY_AGENT", ZERO_ADDRESS)
  );
  const asset = parseAddress("ASSET", env("ASSET"));
  const vaultName = env("VAULT_NAME");
  const vaultSymbol = env("VAULT_SYMBOL");
  const intentThresholdWeight = parseBigInt(
    "INTENT_THRESHOLD_WEIGHT",
    envOr("INTENT_THRESHOLD_WEIGHT", "5")
  );
  const nadfunLens = parseAddress("NADFUN_LENS", envOr("NADFUN_LENS", ZERO_ADDRESS));

  const initialVerifiers = parseAddressList("INITIAL_VERIFIERS", process.env.INITIAL_VERIFIERS);
  const initialVerifierWeights = parseBigIntList(
    "INITIAL_VERIFIER_WEIGHTS",
    process.env.INITIAL_VERIFIER_WEIGHTS
  );
  if (initialVerifiers.length !== initialVerifierWeights.length) {
    throw new Error("INITIAL_VERIFIERS and INITIAL_VERIFIER_WEIGHTS length mismatch");
  }

  const initialAllowedTokens = parseAddressList(
    "INITIAL_ALLOWED_TOKENS",
    process.env.INITIAL_ALLOWED_TOKENS
  );
  const initialAllowedAdapters = parseAddressList(
    "INITIAL_ALLOWED_ADAPTERS",
    process.env.INITIAL_ALLOWED_ADAPTERS
  );

  const deployConfig = {
    fundOwner,
    strategyAgent,
    asset,
    vaultName,
    vaultSymbol,
    intentThresholdWeight,
    nadfunLens,
    initialVerifiers,
    initialVerifierWeights,
    initialAllowedTokens,
    initialAllowedAdapters
  };

  const chain = defineChain({
    id: chainId,
    name: `claw-${chainId}`,
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: {
      default: { http: [rpcUrl] },
      public: { http: [rpcUrl] }
    }
  });
  const account = privateKeyToAccount(signer);
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });

  console.log("[factory-create-fund] deployConfig payload");
  console.log(stringify(deployConfig));

  const simulation = await publicClient.simulateContract({
    account,
    address: factoryAddress,
    abi: FUND_FACTORY_ABI,
    functionName: "createFund",
    args: [deployConfig]
  });
  const [simFundId, simIntentBook, simCore, simVault] = simulation.result;

  console.log("[factory-create-fund] simulation result");
  console.log(
    stringify({
      fundId: simFundId,
      intentBook: simIntentBook,
      core: simCore,
      vault: simVault
    })
  );

  const txHash = await walletClient.writeContract(simulation.request);
  console.log(`[factory-create-fund] txHash=${txHash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  const event = extractEvent(receipt.logs);
  if (!event) {
    throw new Error("FundDeployed event not found in tx receipt");
  }
  console.log("[factory-create-fund] receipt summary");
  console.log(
    stringify({
      status: receipt.status,
      blockNumber: receipt.blockNumber,
      txHash,
      fundId: event.fundId ?? simFundId,
      fundOwner: event.fundOwner ?? fundOwner,
      strategyAgent:
        event.strategyAgent ??
        (strategyAgent === ZERO_ADDRESS ? fundOwner : strategyAgent),
      intentBook: event.intentBook ?? simIntentBook,
      core: event.core ?? simCore,
      vault: event.vault ?? simVault,
      snapshotBook: event.snapshotBook,
      asset: event.asset ?? asset
    })
  );
}

main().catch((error) => {
  console.error("[factory-create-fund] failed");
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
