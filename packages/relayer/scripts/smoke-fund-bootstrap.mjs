#!/usr/bin/env node

const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
const adminId = process.env.ADMIN_LOGIN_ID ?? "admin";
const adminPassword = process.env.ADMIN_LOGIN_PASSWORD;

const fundId = process.env.FUND_ID ?? "demo-fund";
const fundName = process.env.FUND_NAME ?? "OpenClaw Demo Fund";
const strategyBotId = process.env.STRATEGY_BOT_ID ?? "bot-strategy-1";
const strategyBotAddress =
  process.env.STRATEGY_BOT_ADDRESS ??
  "0x00000000000000000000000000000000000000a1";
const verifierThresholdWeight =
  process.env.VERIFIER_THRESHOLD_WEIGHT ?? "3";
const intentThresholdWeight = process.env.INTENT_THRESHOLD_WEIGHT ?? "5";
const strategyPolicyUri = process.env.STRATEGY_POLICY_URI ?? "ipfs://todo";
const telegramRoomId = process.env.TELEGRAM_ROOM_ID ?? "-1001234567890";

if (!adminPassword) {
  console.error("ADMIN_LOGIN_PASSWORD is required");
  process.exit(1);
}

const cookieJar = new Map();

function parseSetCookies(headers) {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const value = headers.get("set-cookie");
  if (!value) return [];
  return value.split(/,(?=[^;,\s]+=)/g);
}

function setCookiesFromResponse(headers) {
  const setCookies = parseSetCookies(headers);
  for (const cookie of setCookies) {
    const pair = cookie.split(";")[0];
    const idx = pair.indexOf("=");
    if (idx <= 0) continue;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (!value) {
      cookieJar.delete(name);
      continue;
    }
    cookieJar.set(name, value);
  }
}

function cookieHeader() {
  return Array.from(cookieJar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function pretty(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function call(name, input) {
  const url = new URL(input.path, baseUrl).toString();
  const headers = { ...(input.headers ?? {}) };
  const cookie = cookieHeader();
  if (cookie) headers.Cookie = cookie;

  console.log(`\n=== ${name} ===`);
  console.log("INPUT");
  console.log(
    pretty({
      method: input.method,
      url,
      headers,
      body: input.bodyPreview ?? input.body ?? null
    })
  );

  const response = await fetch(url, {
    method: input.method,
    headers,
    body: input.body,
    redirect: "manual"
  });
  setCookiesFromResponse(response.headers);

  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  console.log("OUTPUT");
  console.log(
    pretty({
      status: response.status,
      ok: response.ok,
      location: response.headers.get("location"),
      setCookieCount: parseSetCookies(response.headers).length,
      body: parsed
    })
  );

  return { response, parsed, text };
}

async function main() {
  const csrfRes = await call("GET /api/auth/csrf", {
    method: "GET",
    path: "/api/auth/csrf"
  });
  if (!csrfRes.response.ok || !csrfRes.parsed?.csrfToken) {
    throw new Error("failed to fetch csrf token");
  }

  const loginForm = new URLSearchParams({
    csrfToken: csrfRes.parsed.csrfToken,
    id: adminId,
    password: adminPassword,
    callbackUrl: `${baseUrl}/protected`,
    json: "true"
  });

  const loginRes = await call("POST /api/auth/callback/credentials", {
    method: "POST",
    path: "/api/auth/callback/credentials",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: loginForm.toString()
  });
  const redirectLocation = loginRes.response.headers.get("location") ?? "";
  const loginOk =
    loginRes.response.ok ||
    (loginRes.response.status >= 300 &&
      loginRes.response.status < 400 &&
      redirectLocation.includes("/protected"));
  if (!loginOk) {
    throw new Error(
      `login failed (status=${loginRes.response.status}, location=${redirectLocation})`
    );
  }

  const sessionRes = await call("GET /api/auth/session", {
    method: "GET",
    path: "/api/auth/session"
  });
  const sessionUser =
    sessionRes.parsed?.user?.id ??
    sessionRes.parsed?.user?.name ??
    sessionRes.parsed?.user?.email ??
    null;
  if (!sessionRes.response.ok || !sessionUser) {
    throw new Error(`session check failed: ${pretty(sessionRes.parsed)}`);
  }

  const fundBody = {
    fundId,
    fundName,
    strategyBotId,
    strategyBotAddress,
    verifierThresholdWeight,
    intentThresholdWeight,
    strategyPolicyUri,
    telegramRoomId
  };

  const createFundRes = await call("POST /api/v1/funds", {
    method: "POST",
    path: "/api/v1/funds",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(fundBody),
    bodyPreview: fundBody
  });
  if (!createFundRes.response.ok) {
    throw new Error("create fund failed");
  }

  console.log("\n=== DONE ===");
  console.log(
    pretty({
      baseUrl,
      fundId,
      sessionUser,
      cookieNames: Array.from(cookieJar.keys())
    })
  );
}

main().catch((error) => {
  console.error("\nFAILED");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
