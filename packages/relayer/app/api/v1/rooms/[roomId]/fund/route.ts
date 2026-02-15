import { NextResponse } from "next/server";
import { getFundByTelegramRoomId } from "@/lib/supabase";

export async function GET(
  _request: Request,
  context: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await context.params;
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

  return NextResponse.json(
    {
      status: "OK",
      endpoint: "GET /api/v1/rooms/{roomId}/fund",
      roomId: fund.telegram_room_id,
      fundId: fund.fund_id,
      fundName: fund.fund_name
    },
    { status: 200 }
  );
}

