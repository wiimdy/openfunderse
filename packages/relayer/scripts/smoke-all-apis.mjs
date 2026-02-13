#!/usr/bin/env node

import { privateKeyToAccount } from "viem/accounts";
import {
  claimAttestationTypedData,
  intentAttestationTypedData
} from "@claw/protocol-sdk";

const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";

const adminId = process.env.ADMIN_LOGIN_ID ?? "admin";
const adminPassword = process.env.ADMIN_LOGIN_PASSWORD;

const fundId = process.env.FUND_ID ?? "demo-fund";
const fundName = process.env.FUND_NAME ?? "OpenClaw Demo Fund";
const strategyBotId = process.env.STRATEGY_BOT_ID ?? "bot-strategy-1";
const strategyBotApiKey = process.env.STRATEGY_BOT_API_KEY ?? "replace_me";
const strategyBotAddress =
  process.env.STRATEGY_BOT_ADDRESS ??
  "0x00000000000000000000000000000000000000a1";

const crawlerBotId = process.env.CRAWLER_BOT_ID ?? "bot-crawler-1";
const crawlerBotApiKey = process.env.CRAWLER_BOT_API_KEY ?? "replace_me";
const crawlerAddress =
  process.env.CRAWLER_ADDRESS ??
  "0x00000000000000000000000000000000000000c1";

const verifierBotId = process.env.VERIFIER_BOT_ID ?? "bot-verifier-1";
const verifierBotApiKey = process.env.VERIFIER_BOT_API_KEY ?? "replace_me";
const verifierPrivateKey = process.env.VERIFIER_PRIVATE_KEY;

const claimBookAddress = process.env.CLAIM_BOOK_ADDRESS;
const intentBookAddress = process.env.INTENT_BOOK_ADDRESS;
const chainId = process.env.CHAIN_ID ? BigInt(process.env.CHAIN_ID) : null;

const epochId = process.env.EPOCH_ID ? BigInt(process.env.EPOCH_ID) : 1n;
const nowSec = BigInt(Math.floor(Date.now() / 1000));
const expiresAt = nowSec + 3600n;
const claimNonce = process.env.CLAIM_NONCE ? BigInt(process.env.CLAIM_NONCE) : 1n;
const intentNonce = process.env.INTENT_NONCE
  ? BigInt(process.env.INTENT_NONCE)
  : 1n;

const tokenIn =
  process.env.TOKEN_IN ?? "0x00000000000000000000000000000000000000e1";
const tokenOut =
  process.env.TOKEN_OUT ?? "0x00000000000000000000000000000000000000e2";
const vaultAddress =
  process.env.VAULT_ADDRESS ?? "0x00000000000000000000000000000000000000d1";
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
if (!verifierPrivateKey) {
  console.error("VERIFIER_PRIVATE_KEY is required");
  process.exit(1);
}
if (!claimBookAddress || !intentBookAddress || !chainId) {
  console.error(
    "CLAIM_BOOK_ADDRESS, INTENT_BOOK_ADDRESS, CHAIN_ID are required"
  );
  process.exit(1);
}

const verifierAccount = privateKeyToAccount(verifierPrivateKey);
const verifierAddress = verifierAccount.address;

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
    "x-bot-id": strategyBotId,
    "x-bot-api-key": strategyBotApiKey
  };

  const registerCrawler = await call("POST /bots/register crawler", {
    method: "POST",
    path: `/api/v1/funds/${fundId}/bots/register`,
    headers: strategyHeaders,
    body: JSON.stringify({
      role: "crawler",
      botId: crawlerBotId,
      botAddress: crawlerAddress,
      policyUri: "ipfs://crawler-policy",
      telegramHandle: "@crawler_bot"
    })
  });
  assertStatus(registerCrawler.response, [200], "register crawler");

  const registerVerifier = await call("POST /bots/register verifier", {
    method: "POST",
    path: `/api/v1/funds/${fundId}/bots/register`,
    headers: strategyHeaders,
    body: JSON.stringify({
      role: "verifier",
      botId: verifierBotId,
      botAddress: verifierAddress,
      policyUri: "ipfs://verifier-policy",
      telegramHandle: "@verifier_bot"
    })
  });
  assertStatus(registerVerifier.response, [200], "register verifier");

  const listBots = await call("GET /bots/register", {
    method: "GET",
    path: `/api/v1/funds/${fundId}/bots/register`,
    headers: {
      "x-bot-id": strategyBotId,
      "x-bot-api-key": strategyBotApiKey
    }
  });
  assertStatus(listBots.response, [200], "list bots");

  const claimPayload = {
    schemaId: "price_signal_v1",
    sourceType: "WEB",
    sourceRef: `https://example.com/tokens/${tokenOut}`,
    selector: "$.signal",
    extracted: "BUY",
    extractedType: "string",
    timestamp: nowSec.toString(),
    responseHash:
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    evidenceType: "url",
    evidenceURI: "https://example.com/evidence/1",
    crawler: crawlerAddress,
    notes: "smoke-all-apis"
  };
  const createClaim = await call("POST /claims", {
    method: "POST",
    path: `/api/v1/funds/${fundId}/claims`,
    headers: {
      "Content-Type": "application/json",
      "x-bot-id": crawlerBotId,
      "x-bot-api-key": crawlerBotApiKey
    },
    body: JSON.stringify({
      epochId: epochId.toString(),
      claimPayload
    })
  });
  assertStatus(createClaim.response, [200], "create claim");
  const claimHash = createClaim.body?.claimHash;
  if (!claimHash) throw new Error("claimHash missing");

  const listClaims = await call("GET /claims", {
    method: "GET",
    path: `/api/v1/funds/${fundId}/claims`
  });
  assertStatus(listClaims.response, [200], "list claims");

  const claimMsg = {
    claimHash,
    epochId,
    verifier: verifierAddress,
    expiresAt,
    nonce: claimNonce
  };
  const claimSig = await verifierAccount.signTypedData(
    claimAttestationTypedData(
      {
        name: "ClawClaimBook",
        version: "1",
        chainId,
        verifyingContract: claimBookAddress
      },
      claimMsg
    )
  );
  const attestClaim = await call("POST /attestations", {
    method: "POST",
    path: `/api/v1/funds/${fundId}/attestations`,
    headers: {
      "Content-Type": "application/json",
      "x-bot-id": verifierBotId,
      "x-bot-api-key": verifierBotApiKey
    },
    body: JSON.stringify({
      claimHash,
      epochId: epochId.toString(),
      verifier: verifierAddress,
      expiresAt: expiresAt.toString(),
      nonce: claimNonce.toString(),
      signature: claimSig
    })
  });
  assertStatus(attestClaim.response, [200, 202], "attest claim");

  const snapshot = await call("GET /snapshots/latest", {
    method: "GET",
    path: `/api/v1/funds/${fundId}/snapshots/latest`
  });
  assertStatus(snapshot.response, [200], "snapshot latest");
  const snapshotHash = snapshot.body?.snapshot?.snapshotHash;
  if (!snapshotHash) throw new Error("snapshotHash missing");

  const proposeIntent = await call("POST /intents/propose", {
    method: "POST",
    path: `/api/v1/funds/${fundId}/intents/propose`,
    headers: strategyHeaders,
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
    verifier: verifierAddress,
    expiresAt,
    nonce: intentNonce
  };
  const intentSig = await verifierAccount.signTypedData(
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
      "x-bot-id": verifierBotId,
      "x-bot-api-key": verifierBotApiKey
    },
    body: JSON.stringify({
      attestations: [
        {
          intentHash,
          verifier: verifierAddress,
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
      verifierAddress,
      claimHash,
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

