import { NextResponse } from "next/server";
import { requireBotAuth } from "@/lib/bot-auth";
import { getFund, listFundBots, upsertFundBot } from "@/lib/supabase";

const ALLOWED_ROLES = new Set(["participant"]);

export async function POST(
  request: Request,
  context: { params: Promise<{ fundId: string }> }
) {
  const { fundId } = await context.params;
  const botAuth = await requireBotAuth(request, ["bots.register"]);
  if (!botAuth.ok) {
    return botAuth.response;
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const role = String(body.role ?? "").trim().toLowerCase();
  const botId = String(body.botId ?? "").trim();
  const botAddress = String(body.botAddress ?? "").trim();

  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json(
      {
        error: "BAD_REQUEST",
        message: "role must be participant"
      },
      { status: 400 }
    );
  }

  if (!botId || !botAddress) {
    return NextResponse.json(
      {
        error: "BAD_REQUEST",
        message: "botId and botAddress are required."
      },
      { status: 400 }
    );
  }

  const fund = await getFund(fundId);
  if (!fund) {
    return NextResponse.json(
      {
        error: "NOT_FOUND",
        message: `fund not found: ${fundId}`
      },
      { status: 404 }
    );
  }
  if (fund.strategy_bot_id !== botAuth.botId) {
    return NextResponse.json(
      {
        error: "FORBIDDEN",
        message: "only the fund strategy bot can register participant bots",
        expectedStrategyBotId: fund.strategy_bot_id,
        callerBotId: botAuth.botId
      },
      { status: 403 }
    );
  }

  await upsertFundBot({
    fundId,
    botId,
    role,
    botAddress,
    status: "ACTIVE",
    policyUri: body.policyUri ? String(body.policyUri) : null,
    telegramHandle: body.telegramHandle ? String(body.telegramHandle) : null,
    registeredBy: botAuth.botId
  });

  return NextResponse.json(
    {
      status: "OK",
      endpoint: "POST /api/v1/funds/{fundId}/bots/register",
      fundId,
      strategyBotId: botAuth.botId,
      payload: {
        role,
        botId,
        botAddress,
        policyUri: body.policyUri ?? null,
        telegramHandle: body.telegramHandle ?? null
      },
      message: "Bot registered for fund."
    },
    { status: 200 }
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ fundId: string }> }
) {
  const { fundId } = await context.params;
  const botAuth = await requireBotAuth(request, ["bots.register"]);
  if (!botAuth.ok) {
    return botAuth.response;
  }

  const fund = await getFund(fundId);
  if (!fund) {
    return NextResponse.json(
      {
        error: "NOT_FOUND",
        message: `fund not found: ${fundId}`
      },
      { status: 404 }
    );
  }
  if (fund.strategy_bot_id !== botAuth.botId) {
    return NextResponse.json(
      {
        error: "FORBIDDEN",
        message: "only the fund strategy bot can list participant bots",
        expectedStrategyBotId: fund.strategy_bot_id,
        callerBotId: botAuth.botId
      },
      { status: 403 }
    );
  }

  const bots = await listFundBots(fundId);

  return NextResponse.json(
    {
      status: "OK",
      endpoint: "GET /api/v1/funds/{fundId}/bots/register",
      fundId,
      strategyBotId: botAuth.botId,
      count: bots.length,
      bots
    },
    { status: 200 }
  );
}
