#!/usr/bin/env node

import crypto from "node:crypto";
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

async function signAuthHeaders(privateKey, botId) {
  const account = privateKeyToAccount(privateKey);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID();
  const message = `openfunderse:auth:${botId}:${timestamp}:${nonce}`;
  const signature = await account.signMessage({ message });
  return {
    "x-bot-id": botId,
    "x-bot-signature": signature,
    "x-bot-timestamp": timestamp,
    "x-bot-nonce": nonce
  };
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

async function syncWithRelayer(txHash, fundResult, deployConfig) {
  const relayerUrl = process.env.RELAYER_URL;
  if (!relayerUrl) {
    console.log("[factory-create-fund] RELAYER_URL not set, skipping relayer sync");
    return;
  }

  const fundId = process.env.FUND_ID;
  const fundName = process.env.FUND_NAME;
  const strategyBotId = process.env.STRATEGY_BOT_ID;
  const botPrivateKey = process.env.STRATEGY_PRIVATE_KEY || process.env.BOT_PRIVATE_KEY;

  if (!fundId || !fundName || !strategyBotId || !botPrivateKey) {
    console.log("[factory-create-fund] missing FUND_ID/FUND_NAME/STRATEGY_BOT_ID/STRATEGY_PRIVATE_KEY, skipping relayer sync");
    return;
  }

  const strategyBotAddress =
    fundResult.strategyAgent ??
    (deployConfig.strategyAgent === ZERO_ADDRESS
      ? deployConfig.fundOwner
      : deployConfig.strategyAgent);

  const signerAccount = privateKeyToAccount(botPrivateKey);
  const bootstrapNonce = crypto.randomUUID();
  const bootstrapExpiresAt = Math.floor(Date.now() / 1000) + 300;
  const bootstrapMessage =
    `OpenFunderse fund bootstrap\\n` +
    `fundId=${fundId}\\n` +
    `txHash=${txHash}\\n` +
    `strategyBotId=${strategyBotId}\\n` +
    `strategyBotAddress=${strategyBotAddress}\\n` +
    `expiresAt=${bootstrapExpiresAt}\\n` +
    `nonce=${bootstrapNonce}`;
  const bootstrapSignature = await signerAccount.signMessage({ message: bootstrapMessage });

  const authTimestamp = Math.floor(Date.now() / 1000).toString();
  const authNonce = crypto.randomUUID();
  const authMessage = `openfunderse:auth:${strategyBotId}:${authTimestamp}:${authNonce}`;
  const authSignature = await signerAccount.signMessage({ message: authMessage });

  const syncBody = {
    txHash,
    fundId,
    fundName,
    strategyBotId,
    strategyBotAddress,
    verifierThresholdWeight: process.env.VERIFIER_THRESHOLD_WEIGHT ?? "1",
    intentThresholdWeight: process.env.INTENT_THRESHOLD_WEIGHT ?? "5",
    auth: {
      signature: bootstrapSignature,
      nonce: bootstrapNonce,
      expiresAt: String(bootstrapExpiresAt)
    }
  };

  console.log("[factory-create-fund] syncing with relayer");
  console.log(stringify(syncBody));

  const syncUrl = new URL("/api/v1/funds/sync-by-strategy", relayerUrl).toString();
  const response = await fetch(syncUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-bot-id": strategyBotId,
      "x-bot-signature": authSignature,
      "x-bot-timestamp": authTimestamp,
      "x-bot-nonce": authNonce
    },
    body: JSON.stringify(syncBody)
  });

  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }

  if (!response.ok) {
    console.error(`[factory-create-fund] relayer sync failed (status=${response.status})`);
    console.error(stringify(parsed));
    return;
  }

  console.log("[factory-create-fund] relayer sync OK");
  console.log(stringify(parsed));
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
  const fundResult = {
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
  };

  console.log("[factory-create-fund] receipt summary");
  console.log(stringify(fundResult));

  await syncWithRelayer(txHash, fundResult, deployConfig);
}

main().catch((error) => {
  console.error("[factory-create-fund] failed");
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
