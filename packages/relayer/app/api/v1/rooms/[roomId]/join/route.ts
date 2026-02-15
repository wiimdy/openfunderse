import { NextResponse } from "next/server";
import { requireBotAuthAllowUnregistered } from "@/lib/bot-auth";
import { getFundBot, getFundByTelegramRoomId, getStakeWeight, upsertFundBot, upsertStakeWeight } from "@/lib/supabase";

export async function POST(
  request: Request,
  context: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await context.params;

  // Allow first-time bots to join by recovering address from signature headers.
  const botAuth = await requireBotAuthAllowUnregistered(request, []);
  if (!botAuth.ok) {
    return botAuth.response;
  }

  const fund = await getFundByTelegramRoomId(roomId);
  if (!fund) {
    return NextResponse.json(
      {
        error: "NOT_FOUND",
        message: `fund not found for roomId: ${roomId}`
      },
      { status: 404 }
    );
  }

  const existingMembership = await getFundBot(fund.fund_id, botAuth.botId);
  if (existingMembership && existingMembership.role !== "participant") {
    return NextResponse.json(
      {
        error: "CONFLICT",
        message: "botId is already registered in this fund with a different role",
        fundId: fund.fund_id,
        botId: botAuth.botId,
        existingRole: existingMembership.role
      },
      { status: 409 }
    );
  }

  await upsertFundBot({
    fundId: fund.fund_id,
    botId: botAuth.botId,
    role: "participant",
    botAddress: botAuth.botAddress,
    status: "ACTIVE",
    policyUri: null,
    telegramHandle: null,
    registeredBy: botAuth.botId
  });

  // Default stake weight for newly joined participants, without overwriting existing weights.
  const existingStake = await getStakeWeight({
    fundId: fund.fund_id,
    participant: botAuth.botAddress
  });
  if (!existingStake) {
    await upsertStakeWeight({
      fundId: fund.fund_id,
      participant: botAuth.botAddress,
      weight: BigInt(1)
    });
  }

  return NextResponse.json(
    {
      status: "OK",
      endpoint: "POST /api/v1/rooms/{roomId}/join",
      roomId: fund.telegram_room_id,
      fundId: fund.fund_id,
      fundName: fund.fund_name,
      participantBotId: botAuth.botId,
      participantBotAddress: botAuth.botAddress,
      message: existingMembership ? "Participant bot already joined fund." : "Participant bot joined fund."
    },
    { status: 200 }
  );
}
