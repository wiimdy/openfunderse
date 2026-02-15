import { NextResponse } from "next/server";
import { requireBotAuth } from "@/lib/bot-auth";
import { requireFundBotRole } from "@/lib/fund-bot-authz";
import { getSubjectStateByFund, markSubjectApproved } from "@/lib/supabase";

function normalizeTxHash(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) throw new Error("txHash is required");
  if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error("txHash must be a 32-byte hex string");
  }
  return raw.toLowerCase();
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
      {
        error: "BAD_REQUEST",
        message: "invalid json body"
      },
      { status: 400 }
    );
  }

  let txHash: string;
  try {
    txHash = normalizeTxHash(body.txHash);
  } catch (error) {
    return NextResponse.json(
      {
        error: "BAD_REQUEST",
        message: error instanceof Error ? error.message : String(error)
      },
      { status: 400 }
    );
  }

  const state = await getSubjectStateByFund(fundId, "INTENT", intentHash);
  if (!state) {
    return NextResponse.json(
      {
        error: "NOT_FOUND",
        message: "intent subject_state not found",
        fundId,
        intentHash: intentHash.toLowerCase()
      },
      { status: 404 }
    );
  }

  if (state.status !== "READY_FOR_ONCHAIN") {
    return NextResponse.json(
      {
        error: "CONFLICT",
        message: "intent is not in READY_FOR_ONCHAIN state",
        fundId,
        intentHash: intentHash.toLowerCase(),
        currentStatus: state.status
      },
      { status: 409 }
    );
  }

  await markSubjectApproved({
    fundId,
    subjectType: "INTENT",
    subjectHash: intentHash,
    txHash: txHash as `0x${string}`
  });

  return NextResponse.json(
    {
      status: "OK",
      endpoint: "POST /api/v1/funds/{fundId}/intents/{intentHash}/onchain-attested",
      fundId,
      botId: botAuth.botId,
      intentHash: intentHash.toLowerCase(),
      txHash
    },
    { status: 200 }
  );
}
