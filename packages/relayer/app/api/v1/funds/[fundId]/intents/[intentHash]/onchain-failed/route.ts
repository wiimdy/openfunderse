import { NextResponse } from "next/server";
import { requireBotAuth } from "@/lib/bot-auth";
import { requireFundBotRole } from "@/lib/fund-bot-authz";
import { markExecutionJobRetryableByIntent } from "@/lib/supabase";

function parsePositiveInt(raw: unknown, fallback: number): number {
  if (raw === undefined || raw === null) return fallback;
  const num = Number(raw);
  if (!Number.isFinite(num) || num < 0) {
    throw new Error("retryDelayMs must be a non-negative number");
  }
  return Math.trunc(num);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ fundId: string; intentHash: string }> }
) {
  const { fundId, intentHash } = await context.params;
  const botAuth = await requireBotAuth(request, ["intents.propose"]);
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

  const reason = typeof body.error === "string" && body.error.trim().length > 0
    ? body.error.trim()
    : "unknown strategy execution failure";

  let retryDelayMs: number;
  try {
    retryDelayMs = parsePositiveInt(body.retryDelayMs, 30_000);
  } catch (error) {
    return NextResponse.json(
      {
        error: "BAD_REQUEST",
        message: error instanceof Error ? error.message : String(error)
      },
      { status: 400 }
    );
  }

  await markExecutionJobRetryableByIntent({
    fundId,
    intentHash,
    error: reason,
    retryDelayMs
  });

  return NextResponse.json(
    {
      status: "OK",
      endpoint: "POST /api/v1/funds/{fundId}/intents/{intentHash}/onchain-failed",
      fundId,
      botId: botAuth.botId,
      intentHash: intentHash.toLowerCase(),
      retryDelayMs
    },
    { status: 200 }
  );
}
