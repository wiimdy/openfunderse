import { NextResponse } from "next/server";
import { requireBotAuth } from "@/lib/bot-auth";
import { requireFundBotRole } from "@/lib/fund-bot-authz";
import { AggregateError, aggregateEpoch } from "@/lib/epoch-aggregator";

export async function POST(
  _request: Request,
  context: { params: Promise<{ fundId: string; epochId: string }> }
) {
  const { fundId, epochId } = await context.params;

  if (!fundId || typeof fundId !== "string") {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "fundId must be a non-empty string" },
      { status: 400 }
    );
  }

  const botAuth = await requireBotAuth(_request, ["intents.propose"]);
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

  let epoch: bigint;
  try {
    epoch = BigInt(epochId);
  } catch {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "epochId must be an integer" },
      { status: 400 }
    );
  }

  try {
    const result = await aggregateEpoch(fundId, epoch);

    if (result.status === "ALREADY_AGGREGATED") {
      return NextResponse.json(
        {
          status: "ALREADY_AGGREGATED",
          endpoint: "POST /api/v1/funds/{fundId}/epochs/{epochId}/aggregate",
          fundId,
          epochId: epoch.toString(),
          epochStateHash: result.epochStateHash,
          snapshotBookAddress: result.snapshotBookAddress,
          snapshotPublish: result.snapshotPublish
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        status: "OK",
        endpoint: "POST /api/v1/funds/{fundId}/epochs/{epochId}/aggregate",
        fundId,
        epochId: epoch.toString(),
        epochStateHash: result.epochStateHash,
        snapshotBookAddress: result.snapshotBookAddress,
        snapshotPublish: result.snapshotPublish,
        claimScale: result.claimScale,
        participantCount: result.participantCount,
        claimCount: result.claimCount,
        aggregateWeights: result.aggregateWeights,
        rewardSettlement: {
          status: "TODO",
          message: "Reward/mint settlement is out of MVP scope (formula-only)."
        }
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof AggregateError) {
      const status = error.code === "BAD_REQUEST" ? 400 : 500;
      const details: Record<string, unknown> = {};
      const txHash = error.details?.txHash;
      const snapshotBookAddress = error.details?.snapshotBookAddress;

      if (typeof txHash === "string" || txHash === null) {
        details.txHash = txHash;
      }
      if (typeof snapshotBookAddress === "string") {
        details.snapshotBookAddress = snapshotBookAddress;
      }

      return NextResponse.json(
        {
          error: error.code,
          message: error.message,
          ...details
        },
        { status }
      );
    }

    throw error;
  }
}
