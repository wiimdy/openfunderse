import { NextResponse } from "next/server";
import { requireBotAuth } from "@/lib/bot-auth";
import { requireFundBotRole } from "@/lib/fund-bot-authz";
import {
  buildIntentAllowlistHashFromRoute,
  buildCanonicalIntentRecord,
  type IntentExecutionRouteInput,
  type TradeIntent
} from "@claw/protocol-sdk";
import {
  createPublicClient,
  defineChain,
  http,
  type Address
} from "viem";
import {
  getFund,
  getFundDeployment,
  getLatestEpochState,
  insertIntent,
  upsertSubjectState
} from "@/lib/supabase";
import { publishEvent } from "@/lib/event-publisher";
import {
  SNAPSHOT_BOOK_ABI,
  validateSnapshotBookInterface,
  isSnapshotBookValid
} from "@/lib/snapshot-book-validator";

function jsonWithBigInt(value: unknown): string {
  return JSON.stringify(value, (_, inner) =>
    typeof inner === "bigint" ? inner.toString() : inner
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ fundId: string }> }
) {
  const { fundId } = await context.params;
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

  const intentRaw = (body.intent ?? body.tradeIntent) as Record<string, unknown> | undefined;
  const executionRoute = body.executionRoute as
    | Record<string, unknown>
    | undefined;
  const intentUri = body.intentURI ? String(body.intentURI) : null;

  if (!intentRaw) {
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

  let intent: TradeIntent;
  try {
    const action = String(intentRaw.action ?? "");
    if (action !== "BUY" && action !== "SELL") {
      throw new Error("intent.action must be BUY or SELL");
    }

    intent = {
      intentVersion: String(intentRaw.intentVersion ?? "v1"),
      vault: String(intentRaw.vault ?? "") as `0x${string}`,
      action,
      tokenIn: String(intentRaw.tokenIn ?? "") as `0x${string}`,
      tokenOut: String(intentRaw.tokenOut ?? "") as `0x${string}`,
      amountIn: BigInt(String(intentRaw.amountIn ?? "")),
      minAmountOut: BigInt(String(intentRaw.minAmountOut ?? "")),
      deadline: BigInt(String(intentRaw.deadline ?? "")),
      maxSlippageBps: BigInt(String(intentRaw.maxSlippageBps ?? "")),
      snapshotHash: String(intentRaw.snapshotHash ?? "") as `0x${string}`,
      reason: intentRaw.reason ? String(intentRaw.reason) : undefined
    };
  } catch (error) {
    return NextResponse.json(
      {
        error: "BAD_REQUEST",
        message:
          error instanceof Error ? `invalid intent: ${error.message}` : "invalid intent"
      },
      { status: 400 }
    );
  }

  const latestEpochState = await getLatestEpochState(fundId);
  if (!latestEpochState) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "no finalized epoch state available for fund" },
      { status: 400 }
    );
  }

  if (
    String(intent.snapshotHash).toLowerCase() !==
    latestEpochState.epoch_state_hash.toLowerCase()
  ) {
    return NextResponse.json(
      {
        error: "BAD_REQUEST",
        message: "snapshotHash mismatch with latest finalized epoch state hash",
        expectedSnapshotHash: latestEpochState.epoch_state_hash,
        receivedSnapshotHash: intent.snapshotHash
      },
      { status: 400 }
    );
  }

  const deployment = await getFundDeployment(fundId);
  if (deployment) {
    const snapshotBookAddress = deployment.snapshot_book_address as Address;
    const chainIdNum = Number(process.env.CHAIN_ID ?? "");
    const rpcUrl = process.env.RPC_URL ?? "";
    if (
      Number.isFinite(chainIdNum) &&
      chainIdNum > 0 &&
      rpcUrl &&
      /^0x[a-fA-F0-9]{40}$/.test(snapshotBookAddress)
    ) {
      const chain = defineChain({
        id: Math.trunc(chainIdNum),
        name: `claw-${Math.trunc(chainIdNum)}`,
        nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
        rpcUrls: {
          default: { http: [rpcUrl] },
          public: { http: [rpcUrl] }
        }
      });
      const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

      const validation = await validateSnapshotBookInterface(publicClient, snapshotBookAddress);
      if (!isSnapshotBookValid(validation)) {
        return NextResponse.json(
          {
            error: "ONCHAIN_ERROR",
            message: `snapshotBook at ${snapshotBookAddress} does not implement SnapshotBook interface`,
            snapshotBookAddress,
            validation: {
              hasCode: validation.hasCode,
              isSnapshotFinalizedCallable: validation.isSnapshotFinalizedCallable,
              errors: validation.errors
            }
          },
          { status: 502 }
        );
      }

      const finalized = (await publicClient.readContract({
        address: snapshotBookAddress,
        abi: SNAPSHOT_BOOK_ABI,
        functionName: "isSnapshotFinalized",
        args: [intent.snapshotHash]
      })) as boolean;
      if (!finalized) {
        return NextResponse.json(
          {
            error: "BAD_REQUEST",
            message:
              "snapshotHash is not finalized on-chain in SnapshotBook; aggregate the epoch first",
            snapshotHash: intent.snapshotHash
          },
          { status: 400 }
        );
      }
    }
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
    intentJson: jsonWithBigInt(built.intent),
    executionRouteJson: jsonWithBigInt(normalizedExecutionRoute),
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
    epochId: BigInt(latestEpochState.epoch_id),
    thresholdWeight: BigInt(fund.intent_threshold_weight)
  });

  await publishEvent("intent:proposed", fundId, {
    intentHash: built.intentHash,
    snapshotHash: built.intent.snapshotHash,
    action: String(intent.action),
    botId: botAuth.botId
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
