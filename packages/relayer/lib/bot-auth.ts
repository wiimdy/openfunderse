import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

function parseEntries(value: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!value) return result;

  for (const raw of value.split(",")) {
    const entry = raw.trim();
    if (!entry) continue;

    const [id, data] = entry.split(":");
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

export function requireBotAuth(
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

  const keys = parseEntries(process.env.BOT_API_KEYS);
  const expectedKey = keys[botId];

  if (!expectedKey || !secureEqual(expectedKey, providedKey)) {
    return {
      ok: false as const,
      response: unauthorized("Invalid bot credentials.")
    };
  }

  const scopeMap = parseScopes(process.env.BOT_SCOPES);
  const scopes = scopeMap[botId] ?? new Set<string>();

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
