import { NextResponse } from "next/server";
import { requireBotAuth } from "@/lib/bot-auth";
import { requireFundBotRole } from "@/lib/fund-bot-authz";
import { buildEpochStateRecord, type Hex } from "@claw/protocol-sdk";
import {
  listAllocationClaimsByEpoch,
  listStakeWeightsByFund,
  upsertEpochState
} from "@/lib/supabase";

function parseBigints(values: unknown[]): bigint[] {
  return values.map((value) => BigInt(String(value)));
}

function sum(values: bigint[]): bigint {
  return values.reduce((acc, value) => acc + value, BigInt(0));
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ fundId: string; epochId: string }> }
) {
  const { fundId, epochId } = await context.params;

  const botAuth = requireBotAuth(_request, ["intents.propose"]);
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

  const rows = await listAllocationClaimsByEpoch({ fundId, epochId: epoch });
  if (rows.length === 0) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "no allocation claims for epoch" },
      { status: 400 }
    );
  }

  const latestByParticipant = new Map<string, { weights: bigint[]; claimHash: Hex; createdAt: number }>();
  for (const row of rows) {
    const payload = JSON.parse(row.claim_json) as { targetWeights?: unknown[] };
    const weightsRaw = payload.targetWeights;
    if (!Array.isArray(weightsRaw) || weightsRaw.length === 0) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: `invalid targetWeights in claim ${row.claim_hash}` },
        { status: 400 }
      );
    }

    const weights = parseBigints(weightsRaw);
    const key = row.participant.toLowerCase();
    const prev = latestByParticipant.get(key);
    if (!prev || row.created_at > prev.createdAt) {
      latestByParticipant.set(key, {
        weights,
        claimHash: row.claim_hash as Hex,
        createdAt: row.created_at
      });
    }
  }

  const participants = Array.from(latestByParticipant.entries());
  const dimensions = participants[0][1].weights.length;
  for (const [, item] of participants) {
    if (item.weights.length !== dimensions) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "targetWeights dimension mismatch" },
        { status: 400 }
      );
    }
  }

  const claimScale = sum(participants[0][1].weights);
  if (claimScale <= BigInt(0)) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "targetWeights sum must be positive" },
      { status: 400 }
    );
  }
  for (const [, item] of participants) {
    if (sum(item.weights) !== claimScale) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "targetWeights sum mismatch across participants" },
        { status: 400 }
      );
    }
  }

  const stakeRows = await listStakeWeightsByFund(fundId);
  const stakeMap = new Map(stakeRows.map((row) => [row.participant.toLowerCase(), row.weight]));

  let totalStake = BigInt(0);
  const participantStake = new Map<string, bigint>();
  for (const [participant] of participants) {
    const stake = stakeMap.get(participant) ?? BigInt(1);
    participantStake.set(participant, stake);
    totalStake += stake;
  }

  if (totalStake <= BigInt(0)) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "total stake must be positive" },
      { status: 400 }
    );
  }

  const aggregate = Array.from({ length: dimensions }, () => BigInt(0));
  for (const [participant, item] of participants) {
    const stake = participantStake.get(participant) ?? BigInt(0);
    for (let i = 0; i < dimensions; i += 1) {
      aggregate[i] += item.weights[i] * stake;
    }
  }

  const aggregateWeights = aggregate.map((numerator) => numerator / totalStake);
  const aggregateRemainder = claimScale - sum(aggregateWeights);
  if (aggregateRemainder !== BigInt(0) && aggregateWeights.length > 0) {
    aggregateWeights[0] += aggregateRemainder;
  }

  const claimHashes = participants
    .map(([, item]) => item.claimHash)
    .sort((a, b) => a.localeCompare(b));

  const epochState = buildEpochStateRecord({
    epochId: epoch,
    claimHashes
  });

  await upsertEpochState({
    fundId,
    epochId: epoch,
    epochStateHash: epochState.epochStateHash,
    aggregateWeightsJson: JSON.stringify(aggregateWeights.map((v) => v.toString())),
    claimHashes
  });

  return NextResponse.json(
    {
      status: "OK",
      endpoint: "POST /api/v1/funds/{fundId}/epochs/{epochId}/aggregate",
      fundId,
      epochId: epoch.toString(),
      epochStateHash: epochState.epochStateHash,
      claimScale: claimScale.toString(),
      participantCount: participants.length,
      claimCount: claimHashes.length,
      aggregateWeights: aggregateWeights.map((v) => v.toString()),
      rewardSettlement: {
        status: "TODO",
        message: "Reward/mint settlement is out of MVP scope (formula-only)."
      }
    },
    { status: 200 }
  );
}
