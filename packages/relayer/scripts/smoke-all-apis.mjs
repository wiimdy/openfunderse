#!/usr/bin/env node

import crypto from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import {
  intentAttestationTypedData
} from "@claw/protocol-sdk";

const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";

const adminId = process.env.ADMIN_LOGIN_ID ?? "admin";
const adminPassword = process.env.ADMIN_LOGIN_PASSWORD;

const fundId = process.env.FUND_ID ?? "demo-fund";
const fundName = process.env.FUND_NAME ?? "OpenClaw Demo Fund";
const strategyBotId = process.env.STRATEGY_BOT_ID ?? "bot-strategy-1";
const strategyPrivateKey =
  process.env.STRATEGY_PRIVATE_KEY ?? process.env.STRATEGY_BOT_PRIVATE_KEY;
const strategyBotAddress =
  process.env.STRATEGY_BOT_ADDRESS ??
  "0x00000000000000000000000000000000000000a1";

const participantBotId =
  process.env.PARTICIPANT_BOT_ID ??
  process.env.BOT_ID ??
  "bot-participant-1";
const participantPrivateKey =
  process.env.PARTICIPANT_PRIVATE_KEY ??
  process.env.BOT_PRIVATE_KEY ??
  process.env.VERIFIER_PRIVATE_KEY;
const participantBotAddressFromEnv =
  process.env.PARTICIPANT_BOT_ADDRESS ??
  process.env.PARTICIPANT_ADDRESS;

const participant2BotId = process.env.PARTICIPANT2_BOT_ID ?? "bot-participant-2";
const participant2PrivateKey = process.env.PARTICIPANT2_PRIVATE_KEY;
const participant2BotAddressFromEnv =
  process.env.PARTICIPANT2_BOT_ADDRESS ?? process.env.PARTICIPANT2_ADDRESS;

const intentBookAddress = process.env.INTENT_BOOK_ADDRESS;
const chainId = process.env.CHAIN_ID ? BigInt(process.env.CHAIN_ID) : null;

const epochId = process.env.EPOCH_ID ? BigInt(process.env.EPOCH_ID) : 1n;
const nowSec = BigInt(Math.floor(Date.now() / 1000));
const expiresAt = nowSec + 3600n;
const intentNonce = process.env.INTENT_NONCE
  ? BigInt(process.env.INTENT_NONCE)
  : 1n;

const tokenIn =
  process.env.TOKEN_IN ?? "0x00000000000000000000000000000000000000e1";
const tokenOut =
  process.env.TOKEN_OUT ?? "0x00000000000000000000000000000000000000e2";
const vaultAddress =
  process.env.CLAW_VAULT_ADDRESS ?? "0x00000000000000000000000000000000000000d1";
const adapterAddress =
  process.env.ADAPTER_ADDRESS ?? "0x00000000000000000000000000000000000000f1";
const adapterData = process.env.ADAPTER_DATA ?? "0x";
const intentAmountIn = process.env.INTENT_AMOUNT_IN
  ? BigInt(process.env.INTENT_AMOUNT_IN)
  : 1_000_000n;
const routeQuoteAmountOut = process.env.ROUTE_QUOTE_AMOUNT_OUT
  ? BigInt(process.env.ROUTE_QUOTE_AMOUNT_OUT)
  : 950_000n;
const intentMinAmountOut = process.env.INTENT_MIN_AMOUNT_OUT
  ? BigInt(process.env.INTENT_MIN_AMOUNT_OUT)
  : 900_000n;
const intentMaxSlippageBps = process.env.INTENT_MAX_SLIPPAGE_BPS
  ? BigInt(process.env.INTENT_MAX_SLIPPAGE_BPS)
  : 300n;
const intentMaxNotional = process.env.INTENT_MAX_NOTIONAL
  ? BigInt(process.env.INTENT_MAX_NOTIONAL)
  : intentAmountIn;
const intentDeadline = process.env.INTENT_DEADLINE
  ? BigInt(process.env.INTENT_DEADLINE)
  : nowSec + 7200n;

if (!adminPassword) {
  console.error("ADMIN_LOGIN_PASSWORD is required");
  process.exit(1);
}
if (!participantPrivateKey) {
  console.error("BOT_PRIVATE_KEY (or PARTICIPANT_PRIVATE_KEY / VERIFIER_PRIVATE_KEY) is required");
  process.exit(1);
}
if (!strategyPrivateKey) {
  console.error("STRATEGY_PRIVATE_KEY (or STRATEGY_BOT_PRIVATE_KEY) is required");
  process.exit(1);
}
if (!intentBookAddress || !chainId) {
  console.error(
    "INTENT_BOOK_ADDRESS and CHAIN_ID are required"
  );
  process.exit(1);
}

const participantAccount = privateKeyToAccount(participantPrivateKey);
const participantAddress = participantBotAddressFromEnv ?? participantAccount.address;
if (participantAddress.toLowerCase() !== participantAccount.address.toLowerCase()) {
  console.error(
    "PARTICIPANT_BOT_ADDRESS/PARTICIPANT_ADDRESS must match the signer address from BOT_PRIVATE_KEY"
  );
  process.exit(1);
}

const participant2Enabled = Boolean(participant2PrivateKey);
let participant2Account = null;
let participant2Address = null;
if (participant2Enabled) {
  participant2Account = privateKeyToAccount(participant2PrivateKey);
  participant2Address = participant2BotAddressFromEnv ?? participant2Account.address;
  if (participant2Address.toLowerCase() !== participant2Account.address.toLowerCase()) {
    console.error(
      "PARTICIPANT2_BOT_ADDRESS/PARTICIPANT2_ADDRESS must match signer address from PARTICIPANT2_PRIVATE_KEY"
    );
    process.exit(1);
  }
}

const cookieJar = new Map();

function parseSetCookies(headers) {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const raw = headers.get("set-cookie");
  if (!raw) return [];
  return raw.split(/,(?=[^;,\s]+=)/g);
}

function setCookiesFromResponse(headers) {
  for (const cookie of parseSetCookies(headers)) {
    const pair = cookie.split(";")[0];
    const idx = pair.indexOf("=");
    if (idx <= 0) continue;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (!value) cookieJar.delete(name);
    else cookieJar.set(name, value);
  }
}

function cookieHeader() {
  return Array.from(cookieJar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function stringify(v) {
  return JSON.stringify(
    v,
    (_, value) => (typeof value === "bigint" ? value.toString() : value),
    2
  );
}

function assertStatus(res, allowed, step) {
  if (!allowed.includes(res.status)) {
    throw new Error(`${step} failed: status=${res.status}`);
  }
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

async function call(step, { method, path, headers = {}, body = null }) {
  const url = new URL(path, baseUrl).toString();
  const reqHeaders = { ...headers };
  const cookie = cookieHeader();
  if (cookie) reqHeaders.Cookie = cookie;

  console.log(`\n=== ${step} ===`);
  console.log("INPUT");
  console.log(
    stringify({
      method,
      url,
      headers: reqHeaders,
      body
    })
  );

  const response = await fetch(url, {
    method,
    headers: reqHeaders,
    body: body === null ? undefined : body,
    redirect: "manual"
  });
  setCookiesFromResponse(response.headers);

  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  console.log("OUTPUT");
  console.log(
    stringify({
      status: response.status,
      ok: response.ok,
      location: response.headers.get("location"),
      setCookieCount: parseSetCookies(response.headers).length,
      body: parsed
    })
  );

  return { response, body: parsed };
}

async function main() {
  await call("GET /api/v1/metrics (before)", {
    method: "GET",
    path: "/api/v1/metrics"
  });

  const csrf = await call("GET /api/auth/csrf", {
    method: "GET",
    path: "/api/auth/csrf"
  });
  assertStatus(csrf.response, [200], "csrf");
  const csrfToken = csrf.body?.csrfToken;
  if (!csrfToken) throw new Error("csrfToken missing");

  const loginForm = new URLSearchParams({
    csrfToken,
    id: adminId,
    password: adminPassword,
    callbackUrl: `${baseUrl}/protected`,
    json: "true"
  });
  const login = await call("POST /api/auth/callback/credentials", {
    method: "POST",
    path: "/api/auth/callback/credentials",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: loginForm.toString()
  });
  assertStatus(login.response, [200, 302], "login");

  const session = await call("GET /api/auth/session", {
    method: "GET",
    path: "/api/auth/session"
  });
  assertStatus(session.response, [200], "session");
  if (!session.body?.user?.name && !session.body?.user?.id) {
    throw new Error("session user missing");
  }

  const createFundBody = {
    fundId,
    fundName,
    strategyBotId,
    strategyBotAddress,
    verifierThresholdWeight: "1",
    intentThresholdWeight: "1",
    strategyPolicyUri: "ipfs://policy-demo",
    telegramRoomId: "-1001234567890"
  };
  const createFund = await call("POST /api/v1/funds", {
    method: "POST",
    path: "/api/v1/funds",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(createFundBody)
  });
  assertStatus(createFund.response, [200], "create fund");

  const strategyHeaders = {
    "Content-Type": "application/json",
    ...(await signAuthHeaders(strategyPrivateKey, strategyBotId))
  };

  const registerParticipant = await call("POST /bots/register participant", {
    method: "POST",
    path: `/api/v1/funds/${fundId}/bots/register`,
    headers: strategyHeaders,
    body: JSON.stringify({
      role: "participant",
      botId: participantBotId,
      botAddress: participantAddress,
      policyUri: "ipfs://participant-policy",
      telegramHandle: "@participant_bot"
    })
  });
  assertStatus(registerParticipant.response, [200], "register participant");

  const listBots = await call("GET /bots/register", {
    method: "GET",
    path: `/api/v1/funds/${fundId}/bots/register`,
    headers: await signAuthHeaders(strategyPrivateKey, strategyBotId)
  });
  assertStatus(listBots.response, [200], "list bots");

  const createClaim = await call("POST /claims (participant-1)", {
    method: "POST",
    path: `/api/v1/funds/${fundId}/claims`,
    headers: {
      "Content-Type": "application/json",
      ...(await signAuthHeaders(participantPrivateKey, participantBotId))
    },
    body: JSON.stringify({
      claim: {
        claimVersion: "v1",
        fundId,
        epochId: epochId.toString(),
        participant: participantAddress,
        targetWeights: ["700000", "300000"],
        horizonSec: "3600",
        nonce: "1",
        submittedAt: nowSec.toString()
      }
    })
  });
  assertStatus(createClaim.response, [200], "create claim");
  const claimHashes = [createClaim.body?.claimHash].filter(Boolean);

  if (participant2Enabled && participant2Account && participant2Address) {
    const registerParticipant2 = await call("POST /bots/register participant-2", {
      method: "POST",
      path: `/api/v1/funds/${fundId}/bots/register`,
      headers: {
        "Content-Type": "application/json",
        ...(await signAuthHeaders(strategyPrivateKey, strategyBotId))
      },
      body: JSON.stringify({
        role: "participant",
        botId: participant2BotId,
        botAddress: participant2Address
      })
    });
    assertStatus(registerParticipant2.response, [200], "register participant-2");

    const createClaim2 = await call("POST /claims (participant-2)", {
      method: "POST",
      path: `/api/v1/funds/${fundId}/claims`,
      headers: {
        "Content-Type": "application/json",
        ...(await signAuthHeaders(participant2PrivateKey, participant2BotId))
      },
      body: JSON.stringify({
        claim: {
          claimVersion: "v1",
          fundId,
          epochId: epochId.toString(),
          participant: participant2Address,
          targetWeights: ["300000", "700000"],
          horizonSec: "3600",
          nonce: "1",
          submittedAt: nowSec.toString()
        }
      })
    });
    assertStatus(createClaim2.response, [200], "create claim participant-2");
    if (createClaim2.body?.claimHash) claimHashes.push(createClaim2.body.claimHash);
  } else {
    console.log("\n=== NOTE ===");
    console.log(
      "PARTICIPANT2_PRIVATE_KEY not set; running single-participant claim demo."
    );
  }

  const listClaims = await call("GET /claims", {
    method: "GET",
    path: `/api/v1/funds/${fundId}/claims`
  });
  assertStatus(listClaims.response, [200], "list claims");

  const aggregateEpoch = await call("POST /epochs/{epochId}/aggregate", {
    method: "POST",
    path: `/api/v1/funds/${fundId}/epochs/${epochId.toString()}/aggregate`,
    headers: {
      "Content-Type": "application/json",
      ...(await signAuthHeaders(strategyPrivateKey, strategyBotId))
    }
  });
  assertStatus(aggregateEpoch.response, [200], "aggregate epoch");

  const epochStateRes = await call("GET /epochs/latest", {
    method: "GET",
    path: `/api/v1/funds/${fundId}/epochs/latest`
  });
  assertStatus(epochStateRes.response, [200], "epochs latest");
  const snapshotHash = epochStateRes.body?.epochState?.epochStateHash;
  if (!snapshotHash) {
    console.log("\n=== WARN ===");
    console.log(
      "epochStateHash missing. Run epoch aggregation after claim submission."
    );
    console.log(
      "Skipping intent propose/attest steps; completed all offchain API flows up to epoch aggregation."
    );
    return;
  }

  const proposeIntent = await call("POST /intents/propose", {
    method: "POST",
    path: `/api/v1/funds/${fundId}/intents/propose`,
    headers: {
      "Content-Type": "application/json",
      ...(await signAuthHeaders(strategyPrivateKey, strategyBotId))
    },
    body: JSON.stringify({
      intent: {
        intentVersion: "v1",
        vault: vaultAddress,
        action: "BUY",
        tokenIn,
        tokenOut,
        amountIn: intentAmountIn.toString(),
        minAmountOut: intentMinAmountOut.toString(),
        deadline: intentDeadline.toString(),
        maxSlippageBps: intentMaxSlippageBps.toString(),
        snapshotHash
      },
      maxNotional: intentMaxNotional.toString(),
      executionRoute: {
        tokenIn,
        tokenOut,
        quoteAmountOut: routeQuoteAmountOut.toString(),
        minAmountOut: intentMinAmountOut.toString(),
        adapter: adapterAddress,
        adapterData
      }
    })
  });
  assertStatus(proposeIntent.response, [200], "propose intent");
  const intentHash = proposeIntent.body?.intentHash;
  if (!intentHash) throw new Error("intentHash missing");

  const intentMsg = {
    intentHash,
    verifier: participantAddress,
    expiresAt,
    nonce: intentNonce
  };
  const intentSig = await participantAccount.signTypedData(
    intentAttestationTypedData(
      {
        name: "ClawIntentBook",
        version: "1",
        chainId,
        verifyingContract: intentBookAddress
      },
      intentMsg
    )
  );
  const attestIntentBatch = await call("POST /intents/attestations/batch", {
    method: "POST",
    path: `/api/v1/funds/${fundId}/intents/attestations/batch`,
    headers: {
      "Content-Type": "application/json",
      ...(await signAuthHeaders(participantPrivateKey, participantBotId))
    },
    body: JSON.stringify({
      attestations: [
        {
          intentHash,
          verifier: participantAddress,
          expiresAt: expiresAt.toString(),
          nonce: intentNonce.toString(),
          signature: intentSig
        }
      ]
    })
  });
  assertStatus(attestIntentBatch.response, [200], "attest intent batch");

  const fundStatus = await call("GET /fund status", {
    method: "GET",
    path: `/api/v1/funds/${fundId}/status`
  });
  assertStatus(fundStatus.response, [200], "fund status");

  const metrics = await call("GET /api/v1/metrics (after)", {
    method: "GET",
    path: "/api/v1/metrics"
  });
  assertStatus(metrics.response, [200], "metrics after");

  console.log("\n=== DONE ===");
  console.log(
    stringify({
      baseUrl,
      fundId,
      participantAddress,
      participant2Enabled,
      claimHashes,
      snapshotHash,
      intentHash
    })
  );
}

main().catch((error) => {
  console.error("\nFAILED");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
