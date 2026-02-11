import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/authz";
import { getFund, upsertFund, upsertFundBot } from "@/lib/sqlite";

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

  const existing = getFund(fundId);
  if (existing && existing.strategy_bot_id && existing.strategy_bot_id !== strategyBotId) {
    return NextResponse.json(
      {
        error: "CONFLICT",
        message: `strategy bot is immutable for fund ${fundId}. existing=${existing.strategy_bot_id}, incoming=${strategyBotId}`
      },
      { status: 409 }
    );
  }

  upsertFund({
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
  upsertFundBot({
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
