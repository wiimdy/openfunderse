import { NextResponse } from "next/server";
import { requireBotAuth } from "@/lib/bot-auth";
import { requireFundBotRole } from "@/lib/fund-bot-authz";
import { markExecutionJobExecutedByIntent } from "@/lib/supabase";

function parseTxHash(value: unknown): string {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^0x[0-9a-f]{64}$/.test(raw)) {
    throw new Error("txHash is required and must be a 32-byte hex string");
  }
  return raw;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ fundId: string; intentHash: string }> }
) {
  const { fundId, intentHash } = await context.params;
  const botAuth = requireBotAuth(request, ["intents.propose"]);
  if (!botAuth.ok) {
    return botAuth.response;
  }

  const membership = await requireFundBotRole({
    fundId,
    botId: botAuth.botId,
    allowedRoles: ["strategy"]
  });
  if (!membership.ok) {
    return membership.response;
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "invalid json body" },
      { status: 400 }
    );
  }

  let txHash: string;
  try {
    txHash = parseTxHash(body.txHash);
  } catch (error) {
    return NextResponse.json(
      {
        error: "BAD_REQUEST",
        message: error instanceof Error ? error.message : String(error)
      },
      { status: 400 }
    );
  }

  await markExecutionJobExecutedByIntent({
    fundId,
    intentHash,
    txHash
  });

  return NextResponse.json(
    {
      status: "OK",
      endpoint: "POST /api/v1/funds/{fundId}/intents/{intentHash}/onchain-executed",
      fundId,
      botId: botAuth.botId,
      intentHash: intentHash.toLowerCase(),
      txHash
    },
    { status: 200 }
  );
}
