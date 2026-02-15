import { NextResponse } from "next/server";
import { requireBotAuth } from "@/lib/bot-auth";
import { getFundByTelegramRoomId, upsertFundBot, upsertStakeWeight } from "@/lib/supabase";

export async function POST(
  request: Request,
  context: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await context.params;

  // Allow unregistered bots to join by verifying signature headers.
  const botAuth = await requireBotAuth(request, []);
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

  await upsertStakeWeight({
    fundId: fund.fund_id,
    participant: botAuth.botAddress,
    weight: BigInt(1)
  });

  return NextResponse.json(
    {
      status: "OK",
      endpoint: "POST /api/v1/rooms/{roomId}/join",
      roomId: fund.telegram_room_id,
      fundId: fund.fund_id,
      fundName: fund.fund_name,
      participantBotId: botAuth.botId,
      participantBotAddress: botAuth.botAddress,
      message: "Participant bot joined fund."
    },
    { status: 200 }
  );
}

