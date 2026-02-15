#!/usr/bin/env node
/**
 * End-to-end smoke to validate:
 * - Supabase schema is applied (incl. bot_credentials)
 * - DB-backed bot auth works (no BOT_API_KEYS/BOT_SCOPES needed)
 * - Onchain fund deploy -> relayer sync-by-strategy bootstrap -> bot register -> claim -> aggregate -> intent -> attestation
 *
 * This is intentionally a smoke test: it does NOT execute trades onchain.
 */

import { createHash, randomBytes } from "node:crypto";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  http,
  parseAbi
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { intentAttestationTypedData } from "@claw/protocol-sdk";

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

function sha256Hex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function randomApiKey(label) {
  return `${label}_${randomBytes(16).toString("hex")}`;
}

function parseAddress(name, value) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`${name} must be a valid 20-byte hex address`);
  }
  // viem simulateContract is strict about checksum for mixed-case strings.
  // Normalize to lowercase to avoid checksum mismatch issues.
  return value.toLowerCase();
}

function stringify(value) {
  return JSON.stringify(
    value,
    (_, candidate) => (typeof candidate === "bigint" ? candidate.toString() : candidate),
    2
  );
}

function assertStatus(step, res, allowed) {
  if (!allowed.includes(res.status)) {
    throw new Error(`${step} failed: status=${res.status}`);
  }
}

async function fetchJson(step, baseUrl, path, { method, headers, body }) {
  const url = new URL(path, baseUrl).toString();
  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { response, body: parsed, url };
}

function extractFundDeployedEvent(logs) {
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
  const baseUrl = envOr("BASE_URL", "http://localhost:3000");

  const chainId = Number(env("CHAIN_ID"));
  const rpcUrl = env("RPC_URL");
  const factoryAddress = parseAddress("CLAW_FUND_FACTORY_ADDRESS", env("CLAW_FUND_FACTORY_ADDRESS"));

  const signerKey = envOr("FACTORY_SIGNER_PRIVATE_KEY", env("RELAYER_SIGNER_PRIVATE_KEY"));
  const strategyAccount = privateKeyToAccount(signerKey);
  const strategyBotAddress = strategyAccount.address;

  // Participant only signs; doesn't need funds.
  const participantKey = envOr("PARTICIPANT_PRIVATE_KEY", `0x${randomBytes(32).toString("hex")}`);
  const participantAccount = privateKeyToAccount(participantKey);

  const strategyBotId = envOr("STRATEGY_BOT_ID", "bot-strategy-1");
  const participantBotId = envOr("PARTICIPANT_BOT_ID", "bot-participant-1");

  const strategyBotApiKey = envOr("STRATEGY_BOT_API_KEY", randomApiKey("strategy"));
  const participantBotApiKey = envOr("PARTICIPANT_BOT_API_KEY", randomApiKey("participant"));
  const strategyBotApiKeySha256 = sha256Hex(strategyBotApiKey);
  const participantBotApiKeySha256 = sha256Hex(participantBotApiKey);

  const fundId = envOr("FUND_ID", `fund-e2e-${Date.now()}`);
  const fundName = envOr("FUND_NAME", "OpenFunderse E2E DB-Auth");

  const asset = parseAddress("ASSET", env("ASSET"));
  const nadfunLens = parseAddress("NADFUN_LENS", env("NADFUN_LENS"));
  const adapterAddress = parseAddress("ADAPTER_ADDRESS", env("ADAPTER_ADDRESS"));

  const chain = defineChain({
    id: chainId,
    name: `claw-${chainId}`,
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } }
  });
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const strategyWalletClient = createWalletClient({
    account: strategyAccount,
    chain,
    transport: http(rpcUrl)
  });
  const participantWalletClient = createWalletClient({
    account: participantAccount,
    chain,
    transport: http(rpcUrl)
  });

  // 1) Deploy onchain fund stack OR reuse an existing deploy tx hash.
  // Monad RPCs can be strict; if createFund simulation reverts, reuse an existing tx hash instead.
  let txHash = envOr("DEPLOY_TX_HASH", "");
  if (txHash) {
    console.log("\n[e2e] using existing DEPLOY_TX_HASH (skipping onchain createFund)");
  } else {
    const deployConfig = {
      fundOwner: strategyBotAddress,
      strategyAgent: strategyBotAddress,
      asset,
      vaultName: envOr("VAULT_NAME", "OpenFunderse Vault Share"),
      vaultSymbol: envOr("VAULT_SYMBOL", "OFVS"),
      intentThresholdWeight: BigInt(envOr("INTENT_THRESHOLD_WEIGHT", "1")),
      nadfunLens,
      initialVerifiers: [participantAccount.address],
      initialVerifierWeights: [1n],
      initialAllowedTokens: [asset],
      initialAllowedAdapters: [adapterAddress]
    };

    console.log("\n[e2e] onchain createFund deployConfig");
    console.log(
      stringify({
        fundId,
        fundName,
        strategyBotId,
        strategyBotAddress,
        participantBotId,
        participantAddress: participantAccount.address,
        deployConfig
      })
    );

    const simulation = await publicClient.simulateContract({
      account: strategyAccount,
      address: factoryAddress,
      abi: FUND_FACTORY_ABI,
      functionName: "createFund",
      args: [deployConfig]
    });
    txHash = await strategyWalletClient.writeContract(simulation.request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      throw new Error(`createFund tx reverted: ${txHash}`);
    }
    const deployed = extractFundDeployedEvent(receipt.logs);
    if (!deployed) {
      throw new Error("FundDeployed event not found");
    }
    console.log("\n[e2e] onchain createFund receipt");
    console.log(stringify({ txHash, blockNumber: receipt.blockNumber, deployed }));
  }

  // 2) Sync to relayer via signature bootstrap (no pre-existing bot credentials).
  const expiresAt = Math.floor(Date.now() / 1000) + 600;
  const nonce = `0x${randomBytes(16).toString("hex")}`;
  const bootstrapMessage =
    `OpenFunderse fund bootstrap\n` +
    `fundId=${fundId}\n` +
    `txHash=${txHash}\n` +
    `strategyBotId=${strategyBotId}\n` +
    `strategyBotAddress=${strategyBotAddress}\n` +
    `strategyBotApiKeySha256=${strategyBotApiKeySha256}\n` +
    `expiresAt=${expiresAt}\n` +
    `nonce=${nonce}`;

  const signature = await strategyWalletClient.signMessage({
    account: strategyAccount,
    message: bootstrapMessage
  });

  const sync = await fetchJson("sync-by-strategy", baseUrl, "/api/v1/funds/sync-by-strategy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: {
      fundId,
      fundName,
      strategyBotId,
      strategyBotAddress,
      txHash,
      verifierThresholdWeight: "1",
      intentThresholdWeight: "1",
      strategyBotApiKeySha256: strategyBotApiKeySha256,
      strategyBotScopes: "funds.bootstrap|bots.register|intents.propose",
      auth: {
        signature,
        expiresAt,
        nonce
      }
    }
  });
  assertStatus("sync-by-strategy", sync.response, [200]);
  console.log("\n[e2e] relayer sync-by-strategy OK");
  const onchainDeployment = sync.body?.onchainDeployment;
  const intentBookAddress = onchainDeployment?.intentBookAddress;
  const vaultAddress = onchainDeployment?.clawVaultAddress;
  if (!intentBookAddress || !vaultAddress) {
    throw new Error("sync-by-strategy response missing onchain deployment addresses");
  }

  // 3) Register participant bot (also persists participant credential to DB).
  const strategyHeaders = {
    "Content-Type": "application/json",
    "x-bot-id": strategyBotId,
    "x-bot-api-key": strategyBotApiKey
  };

  const register = await fetchJson("bots/register", baseUrl, `/api/v1/funds/${fundId}/bots/register`, {
    method: "POST",
    headers: strategyHeaders,
    body: {
      role: "participant",
      botId: participantBotId,
      botAddress: participantAccount.address,
      botApiKeySha256: participantBotApiKeySha256,
      botScopes: "claims.submit|intents.attest",
      policyUri: "ipfs://participant-policy-e2e",
      telegramHandle: "@participant_bot_e2e"
    }
  });
  assertStatus("bots/register", register.response, [200]);

  // 4) Submit allocation claim as participant using DB-backed auth.
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const epochId = 1n;
  const submitClaim = await fetchJson("claims", baseUrl, `/api/v1/funds/${fundId}/claims`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-bot-id": participantBotId,
      "x-bot-api-key": participantBotApiKey
    },
    body: {
      claim: {
        claimVersion: "v1",
        fundId,
        epochId: epochId.toString(),
        participant: participantAccount.address,
        targetWeights: ["700000", "300000"],
        horizonSec: "3600",
        nonce: "1",
        submittedAt: nowSec.toString()
      }
    }
  });
  assertStatus("claims", submitClaim.response, [200]);
  const claimHash = submitClaim.body?.claimHash;
  if (!claimHash) throw new Error("claimHash missing from /claims response");

  // 5) Aggregate epoch as strategy.
  const aggregate = await fetchJson("epochs/aggregate", baseUrl, `/api/v1/funds/${fundId}/epochs/${epochId.toString()}/aggregate`, {
    method: "POST",
    headers: strategyHeaders,
    body: {}
  });
  assertStatus("epochs/aggregate", aggregate.response, [200]);

  const latest = await fetchJson("epochs/latest", baseUrl, `/api/v1/funds/${fundId}/epochs/latest`, {
    method: "GET",
    headers: {}
  });
  assertStatus("epochs/latest", latest.response, [200]);
  const snapshotHash = latest.body?.epochState?.epochStateHash ?? latest.body?.epochStateHash ?? latest.body?.epoch_state_hash;
  if (!snapshotHash) throw new Error("snapshotHash missing from /epochs/latest response");

  // 6) Propose intent bound to snapshotHash.
  const vault = vaultAddress;
  const tokenIn = asset;
  const tokenOut = "0x00000000000000000000000000000000000000e2";
  const minAmountOut = 1n;
  const amountIn = 1n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const intent = {
    intentVersion: "v1",
    vault,
    action: "SELL",
    tokenIn,
    tokenOut,
    amountIn: amountIn.toString(),
    minAmountOut: minAmountOut.toString(),
    deadline: deadline.toString(),
    maxSlippageBps: "300",
    snapshotHash: snapshotHash,
    reason: "e2e smoke"
  };

  const executionRoute = {
    tokenIn,
    tokenOut,
    quoteAmountOut: "1",
    minAmountOut: minAmountOut.toString(),
    adapter: adapterAddress,
    adapterData: "0x00"
  };

  const propose = await fetchJson("intents/propose", baseUrl, `/api/v1/funds/${fundId}/intents/propose`, {
    method: "POST",
    headers: strategyHeaders,
    body: {
      intent,
      executionRoute,
      maxNotional: amountIn.toString()
    }
  });
  assertStatus("intents/propose", propose.response, [200]);
  const intentHash = propose.body?.intentHash;
  if (!intentHash) throw new Error("intentHash missing from /intents/propose response");

  // 7) Attest intent (EIP-712) as participant.
  const typed = intentAttestationTypedData({
    chainId: BigInt(chainId),
    intentBook: intentBookAddress,
    intentHash,
    verifier: participantAccount.address,
    expiresAt: nowSec + 3600n,
    nonce: 1n
  });

  const attestationSig = await participantWalletClient.signTypedData({
    account: participantAccount,
    domain: typed.domain,
    types: typed.types,
    primaryType: typed.primaryType,
    message: typed.message
  });

  const attest = await fetchJson("intents/attestations/batch", baseUrl, `/api/v1/funds/${fundId}/intents/attestations/batch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-bot-id": participantBotId,
      "x-bot-api-key": participantBotApiKey
    },
    body: {
      attestations: [
        {
          intentHash,
          verifier: participantAccount.address,
          expiresAt: (nowSec + 3600n).toString(),
          nonce: "1",
          signature: attestationSig
        }
      ]
    }
  });
  assertStatus("intents/attestations/batch", attest.response, [200, 207]);

  // 8) Fetch onchain bundle (strategy).
  const bundle = await fetchJson("onchain-bundle", baseUrl, `/api/v1/funds/${fundId}/intents/${intentHash}/onchain-bundle`, {
    method: "GET",
    headers: {
      "x-bot-id": strategyBotId,
      "x-bot-api-key": strategyBotApiKey
    }
  });
  assertStatus("onchain-bundle", bundle.response, [200]);

  console.log("\n[e2e] SUCCESS");
  console.log(
    stringify({
      baseUrl,
      fundId,
      txHash,
      strategyBotId,
      strategyBotAddress,
      participantBotId,
      participantAddress: participantAccount.address,
      intentHash,
      snapshotHash,
      onchain: onchainDeployment,
      note: "DB-backed bot auth validated via sync-by-strategy + bots/register; no BOT_API_KEYS required."
    })
  );
}

main().catch((error) => {
  console.error("\n[e2e] FAILED");
  console.error(error?.stack ?? String(error));
  process.exit(1);
});
