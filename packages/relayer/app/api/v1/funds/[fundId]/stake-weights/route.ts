import { NextResponse } from "next/server";
import { requireBotAuth } from "@/lib/bot-auth";
import { requireFundBotRole } from "@/lib/fund-bot-authz";
import { getFundBot, upsertStakeWeight } from "@/lib/supabase";
import { validateStakeWeightInput } from "@/lib/stake-validation";

export async function POST(
  request: Request,
  context: { params: Promise<{ fundId: string }> }
) {
  const { fundId } = await context.params;

  const botAuth = await requireBotAuth(request, ["bots.register"]);
  if (!botAuth.ok) return botAuth.response;

  const membership = await requireFundBotRole({
    fundId,
    botId: botAuth.botId,
    allowedRoles: ["strategy"]
  });
  if (!membership.ok) return membership.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "invalid json body" },
      { status: 400 }
    );
  }

  const validation = validateStakeWeightInput({
    participant: String(body.participant ?? ""),
    weight: String(body.weight ?? "")
  });
  if (!validation.ok) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: validation.message },
      { status: 400 }
    );
  }

  const participantBotId = String(body.participantBotId ?? "").trim();
  if (!participantBotId) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "participantBotId is required" },
      { status: 400 }
    );
  }

  const targetBot = await getFundBot(fundId, participantBotId);
  if (
    !targetBot ||
    targetBot.status.toUpperCase() !== "ACTIVE" ||
    targetBot.role !== "participant"
  ) {
    return NextResponse.json(
      {
        error: "NOT_FOUND",
        message: "participant bot not found or not active in this fund"
      },
      { status: 404 }
    );
  }

  await upsertStakeWeight({
    fundId,
    participant: validation.participant,
    weight: validation.weight
  });

  return NextResponse.json(
    {
      status: "OK",
      endpoint: "POST /api/v1/funds/{fundId}/stake-weights",
      fundId,
      participantBotId,
      participant: validation.participant,
      weight: validation.weight.toString()
    },
    { status: 200 }
  );
}
