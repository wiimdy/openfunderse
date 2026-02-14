import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/authz";
import { getFund, listPublicFunds, upsertFund, upsertFundBot } from "@/lib/supabase";

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

export async function POST(request: Request) {
  const admin = await requireAdminSession();
  if (!admin.ok) {
    return admin.response;
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const fundName = String(body.fundName ?? "").trim();
  const fundId = String(body.fundId ?? "").trim();
  const strategyBotId = String(body.strategyBotId ?? "").trim();
  const strategyBotAddress = String(body.strategyBotAddress ?? "").trim();
  if (!fundName) {
    return NextResponse.json(
      {
        error: "BAD_REQUEST",
        message: "fundName is required."
      },
      { status: 400 }
    );
  }
  if (!fundId) {
    return NextResponse.json(
      {
        error: "BAD_REQUEST",
        message: "fundId is required."
      },
      { status: 400 }
    );
  }
  if (!strategyBotId || !strategyBotAddress) {
    return NextResponse.json(
      {
        error: "BAD_REQUEST",
        message: "strategyBotId and strategyBotAddress are required."
      },
      { status: 400 }
    );
  }

  const verifierThresholdWeight = BigInt(String(body.verifierThresholdWeight ?? "3"));
  const intentThresholdWeight = BigInt(String(body.intentThresholdWeight ?? "5"));
  if (verifierThresholdWeight <= BigInt(0) || intentThresholdWeight <= BigInt(0)) {
    return NextResponse.json(
      {
        error: "BAD_REQUEST",
        message: "verifierThresholdWeight and intentThresholdWeight must be positive integers."
      },
      { status: 400 }
    );
  }

  const existing = await getFund(fundId);
  if (existing && existing.strategy_bot_id && existing.strategy_bot_id !== strategyBotId) {
    return NextResponse.json(
      {
        error: "CONFLICT",
        message: `strategy bot is immutable for fund ${fundId}. existing=${existing.strategy_bot_id}, incoming=${strategyBotId}`
      },
      { status: 409 }
    );
  }

  await upsertFund({
    fundId,
    fundName,
    strategyBotId,
    strategyBotAddress,
    verifierThresholdWeight,
    intentThresholdWeight,
    strategyPolicyUri: body.strategyPolicyUri ? String(body.strategyPolicyUri) : null,
    telegramRoomId: body.telegramRoomId ? String(body.telegramRoomId) : null,
    createdBy: admin.adminId
  });

  // Ensure strategy bot appears in bot registry as the unique room operator for this fund.
  await upsertFundBot({
    fundId,
    botId: strategyBotId,
    role: "strategy",
    botAddress: strategyBotAddress,
    status: "ACTIVE",
    policyUri: body.strategyPolicyUri ? String(body.strategyPolicyUri) : null,
    telegramHandle: body.telegramHandle ? String(body.telegramHandle) : null,
    registeredBy: admin.adminId
  });

  return NextResponse.json(
    {
      status: "OK",
      endpoint: "POST /api/v1/funds",
      adminId: admin.adminId,
      payload: {
        fundId,
        fundName,
        strategyBotId,
        strategyBotAddress,
        verifierThresholdWeight: verifierThresholdWeight.toString(),
        intentThresholdWeight: intentThresholdWeight.toString(),
        strategyPolicyUri: body.strategyPolicyUri ?? null
      },
      message: "Fund config persisted."
    },
    { status: 200 }
  );
}
