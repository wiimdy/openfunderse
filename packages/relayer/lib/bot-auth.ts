import { NextResponse } from "next/server";
import { verifyMessage, type Address, type Hex } from "viem";
import { getBotsByBotId, insertBotAuthNonce } from "@/lib/supabase";

const AUTH_MAX_AGE_SECONDS = 300;

const ROLE_SCOPES: Record<string, string[]> = {
  strategy: ["intents.propose", "bots.register", "funds.bootstrap"],
  participant: ["claims.submit", "intents.attest"]
};

function unauthorized(message: string) {
  return NextResponse.json({ error: "UNAUTHORIZED", message }, { status: 401 });
}

export async function requireBotAuth(
  request: Request,
  requiredScopes: string[] = []
) {
  const botId = request.headers.get("x-bot-id")?.trim() ?? "";
  const signature = request.headers.get("x-bot-signature")?.trim() ?? "";
  const timestamp = request.headers.get("x-bot-timestamp")?.trim() ?? "";
  const nonce = request.headers.get("x-bot-nonce")?.trim() ?? "";

  if (!botId || !signature || !timestamp || !nonce) {
    return {
      ok: false as const,
      response: unauthorized("x-bot-id, x-bot-signature, x-bot-timestamp, and x-bot-nonce headers are required.")
    };
  }

  const ts = Number(timestamp);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > AUTH_MAX_AGE_SECONDS) {
    return {
      ok: false as const,
      response: unauthorized("Signature expired or invalid timestamp.")
    };
  }

  const bots = await getBotsByBotId(botId);
  if (!bots.length) {
    return {
      ok: false as const,
      response: unauthorized("Bot not registered.")
    };
  }

  const botAddress = bots[0].bot_address as Address;
  const message = `openfunderse:auth:${botId}:${timestamp}:${nonce}`;

  let valid = false;
  try {
    valid = await verifyMessage({
      address: botAddress,
      message,
      signature: signature as Hex
    });
  } catch {
    valid = false;
  }

  if (!valid) {
    return {
      ok: false as const,
      response: unauthorized("Invalid signature.")
    };
  }

  const nonceInsert = await insertBotAuthNonce(botId, nonce);
  if (!nonceInsert.ok) {
    return {
      ok: false as const,
      response: unauthorized("nonce already used")
    };
  }

  const roles = new Set(bots.map((b) => b.role));
  const scopes = new Set<string>();
  for (const role of Array.from(roles)) {
    for (const scope of ROLE_SCOPES[role] ?? []) {
      scopes.add(scope);
    }
  }

  for (const scope of requiredScopes) {
    if (!scopes.has(scope)) {
      return {
        ok: false as const,
        response: NextResponse.json(
          { error: "FORBIDDEN", message: `Missing bot scope: ${scope}`, botId },
          { status: 403 }
        )
      };
    }
  }

  return {
    ok: true as const,
    botId,
    botAddress,
    scopes: Array.from(scopes)
  };
}
