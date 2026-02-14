import { NextResponse } from "next/server";
import { listPublicFunds } from "@/lib/supabase";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limitRaw = url.searchParams.get("limit");
  const offsetRaw = url.searchParams.get("offset");
  const limit = limitRaw ? Number(limitRaw) : 50;
  const offset = offsetRaw ? Number(offsetRaw) : 0;

  if (!Number.isFinite(limit) || limit <= 0) {
    return NextResponse.json(
      {
        error: "BAD_REQUEST",
        message: "limit must be a positive number"
      },
      { status: 400 }
    );
  }
  if (!Number.isFinite(offset) || offset < 0) {
    return NextResponse.json(
      {
        error: "BAD_REQUEST",
        message: "offset must be a non-negative number"
      },
      { status: 400 }
    );
  }

  const funds = await listPublicFunds({
    limit: Math.trunc(limit),
    offset: Math.trunc(offset)
  });

  return NextResponse.json(
    {
      status: "OK",
      endpoint: "GET /api/v1/funds",
      total: funds.length,
      limit: Math.trunc(limit),
      offset: Math.trunc(offset),
      funds: funds.map((fund) => ({
        fundId: fund.fund_id,
        fundName: fund.fund_name,
        strategyBotId: fund.strategy_bot_id,
        strategyBotAddress: fund.strategy_bot_address,
        verifierThresholdWeight: fund.verifier_threshold_weight,
        intentThresholdWeight: fund.intent_threshold_weight,
        strategyPolicyUri: fund.strategy_policy_uri,
        telegramRoomId: fund.telegram_room_id,
        isVerified: fund.is_verified,
        visibility: fund.visibility,
        verificationNote: fund.verification_note,
        updatedAt: fund.updated_at
      }))
    },
    { status: 200 }
  );
}

export async function POST() {
  return NextResponse.json(
    {
      status: "DISABLED",
      endpoint: "POST /api/v1/funds",
      message: "Fund creation is disabled. Use an existing fund projection only."
    },
    { status: 410 }
  );
}
