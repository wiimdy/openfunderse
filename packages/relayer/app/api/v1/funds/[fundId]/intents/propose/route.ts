import { NextResponse } from "next/server";
import { requireBotAuth } from "@/lib/bot-auth";
import {
  buildIntentAllowlistHashFromRoute,
  buildCanonicalIntentRecord,
  type IntentExecutionRouteInput,
  type TradeIntent
} from "@claw/protocol-sdk";
import {
  getFund,
  getLatestSnapshot,
  insertIntent,
  upsertSubjectState
} from "@/lib/supabase";

export async function POST(
  request: Request,
  context: { params: Promise<{ fundId: string }> }
) {
  const { fundId } = await context.params;
  const botAuth = requireBotAuth(request, ["intents.propose"]);
  if (!botAuth.ok) {
    return botAuth.response;
  }

  const fund = await getFund(fundId);
  if (!fund) {
    return NextResponse.json(
      { error: "NOT_FOUND", message: `fund not found: ${fundId}` },
      { status: 404 }
    );
  }

  if (fund.strategy_bot_id !== botAuth.botId) {
    return NextResponse.json(
      {
        error: "FORBIDDEN",
        message: "only strategy bot can propose intents",
        expectedStrategyBotId: fund.strategy_bot_id,
        callerBotId: botAuth.botId
      },
      { status: 403 }
    );
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

  const intent = (body.intent ?? body.tradeIntent) as TradeIntent | undefined;
  const executionRoute = body.executionRoute as
    | Record<string, unknown>
    | undefined;
  const intentUri = body.intentURI ? String(body.intentURI) : null;

  if (!intent) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "intent is required" },
      { status: 400 }
    );
  }
  if (!executionRoute) {
    return NextResponse.json(
      {
        error: "BAD_REQUEST",
        message: "executionRoute is required"
      },
      { status: 400 }
    );
  }

  const latestSnapshot = await getLatestSnapshot(fundId);
  if (!latestSnapshot) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "no finalized snapshot available for fund" },
      { status: 400 }
    );
  }

  if (String(intent.snapshotHash).toLowerCase() !== latestSnapshot.snapshot_hash.toLowerCase()) {
    return NextResponse.json(
      {
        error: "BAD_REQUEST",
        message: "snapshotHash mismatch with latest finalized snapshot",
        expectedSnapshotHash: latestSnapshot.snapshot_hash,
        receivedSnapshotHash: intent.snapshotHash
      },
      { status: 400 }
    );
  }

  let allowlistHash: `0x${string}`;
  let normalizedExecutionRoute: IntentExecutionRouteInput;
  try {
    const route: IntentExecutionRouteInput = {
      tokenIn: String(executionRoute.tokenIn) as `0x${string}`,
      tokenOut: String(executionRoute.tokenOut) as `0x${string}`,
      quoteAmountOut: BigInt(String(executionRoute.quoteAmountOut)),
      minAmountOut: BigInt(String(executionRoute.minAmountOut)),
      adapter: String(executionRoute.adapter) as `0x${string}`,
      adapterData: executionRoute.adapterData
        ? (String(executionRoute.adapterData) as `0x${string}`)
        : undefined,
      adapterDataHash: executionRoute.adapterDataHash
        ? (String(executionRoute.adapterDataHash) as `0x${string}`)
        : undefined
    };

    if (!route.adapterData) {
      return NextResponse.json(
        {
          error: "BAD_REQUEST",
          message: "executionRoute.adapterData is required"
        },
        { status: 400 }
      );
    }

    if (
      route.tokenIn.toLowerCase() !== intent.tokenIn.toLowerCase() ||
      route.tokenOut.toLowerCase() !== intent.tokenOut.toLowerCase() ||
      route.minAmountOut !== intent.minAmountOut
    ) {
      return NextResponse.json(
        {
          error: "BAD_REQUEST",
          message: "executionRoute tokenIn/tokenOut/minAmountOut must match intent"
        },
        { status: 400 }
      );
    }

    allowlistHash = buildIntentAllowlistHashFromRoute(route);
    normalizedExecutionRoute = route;
  } catch (error) {
    return NextResponse.json(
      {
        error: "BAD_REQUEST",
        message:
          error instanceof Error
            ? `invalid executionRoute: ${error.message}`
            : "invalid executionRoute"
      },
      { status: 400 }
    );
  }

  let built;
  try {
    built = buildCanonicalIntentRecord({
      intent,
      allowlistHash,
      maxNotional: body.maxNotional ? BigInt(String(body.maxNotional)) : intent.amountIn
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "BAD_REQUEST",
        message: error instanceof Error ? error.message : String(error)
      },
      { status: 400 }
    );
  }

  const inserted = await insertIntent({
    fundId,
    intentHash: built.intentHash,
    snapshotHash: built.intent.snapshotHash,
    intentUri,
    intentJson: JSON.stringify(built.intent),
    executionRouteJson: JSON.stringify(normalizedExecutionRoute, (_, value) =>
      typeof value === "bigint" ? value.toString() : value
    ),
    allowlistHash: built.constraints.allowlistHash,
    maxSlippageBps: built.constraints.maxSlippageBps,
    maxNotional: built.constraints.maxNotional,
    deadline: built.constraints.deadline,
    createdBy: botAuth.botId
  });

  if (!inserted.ok) {
    return NextResponse.json(
      {
        error: "CONFLICT",
        message: "duplicate intentHash",
        intentHash: built.intentHash
      },
      { status: 409 }
    );
  }

  await upsertSubjectState({
    fundId,
    subjectType: "INTENT",
    subjectHash: built.intentHash,
    epochId: BigInt(latestSnapshot.epoch_id),
    thresholdWeight: BigInt(fund.intent_threshold_weight)
  });

  return NextResponse.json(
    {
      status: "OK",
      endpoint: "POST /api/v1/funds/{fundId}/intents/propose",
      fundId,
      botId: botAuth.botId,
      intentHash: built.intentHash,
      snapshotHash: built.intent.snapshotHash,
      constraints: {
        allowlistHash: built.constraints.allowlistHash,
        maxSlippageBps: built.constraints.maxSlippageBps.toString(),
        maxNotional: built.constraints.maxNotional.toString(),
        deadline: built.constraints.deadline.toString()
      }
    },
    { status: 200 }
  );
}
