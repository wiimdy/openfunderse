import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { getBotCredential } from "@/lib/supabase";

const SHA256_PREFIX = "sha256:";
const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/;

function parseEntries(value: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!value) return result;

  for (const raw of value.split(",")) {
    const entry = raw.trim();
    if (!entry) continue;

    const separatorIndex = entry.indexOf(":");
    if (separatorIndex <= 0) continue;
    const id = entry.slice(0, separatorIndex);
    const data = entry.slice(separatorIndex + 1);
    if (!id || !data) continue;
    result[id.trim()] = data.trim();
  }

  return result;
}

function parseScopes(value: string | undefined): Record<string, Set<string>> {
  const map = parseEntries(value);
  const out: Record<string, Set<string>> = {};

  for (const [botId, scopeString] of Object.entries(map)) {
    out[botId] = new Set(
      scopeString
        .split("|")
        .map((scope) => scope.trim())
        .filter(Boolean)
    );
  }

  return out;
}

function parseScopeSet(value: string | undefined): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split("|")
      .map((scope) => scope.trim())
      .filter(Boolean)
  );
}

function unauthorized(message: string) {
  return NextResponse.json(
    {
      error: "UNAUTHORIZED",
      message
    },
    { status: 401 }
  );
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function verifyBotApiKey(expectedKey: string, providedKey: string): boolean {
  const normalizedExpected = expectedKey.trim();
  const lowerExpected = normalizedExpected.toLowerCase();

  if (lowerExpected.startsWith(SHA256_PREFIX)) {
    const expectedHash = normalizedExpected.slice(SHA256_PREFIX.length).trim().toLowerCase();
    if (!SHA256_HEX_REGEX.test(expectedHash)) return false;

    const providedHash = sha256Hex(providedKey);
    return secureEqual(expectedHash, providedHash);
  }

  return secureEqual(normalizedExpected, providedKey);
}

export function requireBotAuth(
  request: Request,
  requiredScopes: string[] = []
) {
  throw new Error("requireBotAuth must be awaited; use requireBotAuthAsync()");
}

export async function requireBotAuthAsync(
  request: Request,
  requiredScopes: string[] = []
) {
  const botId = request.headers.get("x-bot-id")?.trim() ?? "";
  const providedKey = request.headers.get("x-bot-api-key")?.trim() ?? "";

  if (!botId || !providedKey) {
    return {
      ok: false as const,
      response: unauthorized("x-bot-id and x-bot-api-key headers are required.")
    };
  }

  // Prefer DB-backed credentials (registered during fund/bot registration).
  // Fall back to env BOT_API_KEYS/BOT_SCOPES for legacy deployments.
  let expectedKey = "";
  let scopes = new Set<string>();

  try {
    const row = await getBotCredential(botId);
    if (row?.api_key) {
      expectedKey = row.api_key;
      scopes = parseScopeSet(row.scopes);
    }
  } catch {
    // ignore DB errors and fall back to env-based auth
  }

  if (!expectedKey) {
    const keys = parseEntries(process.env.BOT_API_KEYS);
    expectedKey = keys[botId] ?? "";
    const scopeMap = parseScopes(process.env.BOT_SCOPES);
    scopes = scopeMap[botId] ?? new Set<string>();
  }

  if (!expectedKey || !verifyBotApiKey(expectedKey, providedKey)) {
    return {
      ok: false as const,
      response: unauthorized("Invalid bot credentials.")
    };
  }

  for (const scope of requiredScopes) {
    if (!scopes.has(scope)) {
      return {
        ok: false as const,
        response: NextResponse.json(
          {
            error: "FORBIDDEN",
            message: `Missing bot scope: ${scope}`,
            botId
          },
          { status: 403 }
        )
      };
    }
  }

  return {
    ok: true as const,
    botId,
    scopes: Array.from(scopes)
  };
}
