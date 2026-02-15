import {
  openEpoch,
  getActiveEpoch,
  closeEpoch,
  markEpochAggregated,
  extendEpoch,
  getLatestEpochState,
  listActionableFunds
} from "@/lib/supabase";
import { aggregateEpoch } from "@/lib/epoch-aggregator";
import { publishEvent } from "@/lib/event-publisher";

export type TickResult =
  | { action: "OPENED"; fundId: string; epochId: string }
  | { action: "AGGREGATED"; fundId: string; epochId: string; epochStateHash: string }
  | { action: "EXTENDED"; fundId: string; epochId: string; newClosesAt: number }
  | { action: "NOOP"; fundId: string; reason: string }
  | { action: "SKIPPED"; fundId: string; reason: string }
  | { action: "ERROR"; fundId: string; error: string };

export async function tickEpoch(input: {
  fundId: string;
  epochDurationMs: number;
  epochMinClaims: number;
  epochMaxClaims: number;
  nowMs: number;
}): Promise<TickResult> {
  const { fundId, epochDurationMs, epochMinClaims, epochMaxClaims, nowMs: now } = input;

  const activeEpoch = await getActiveEpoch(fundId);

  if (!activeEpoch) {
    const latestState = await getLatestEpochState(fundId);
    const lastEpochId = latestState ? Number(latestState.epoch_id) : 0;
    const nextEpochId = String(lastEpochId + 1);
    const closesAt = now + epochDurationMs;

    try {
      await openEpoch({ fundId, epochId: nextEpochId, closesAt });
    } catch (error) {
      if (isDuplicateOrConflict(error)) {
        return { action: "SKIPPED", fundId, reason: "concurrent open detected" };
      }
      throw error;
    }

    await publishEvent("epoch:opened", fundId, {
      epochId: nextEpochId,
      closesAt
    });

    return { action: "OPENED", fundId, epochId: nextEpochId };
  }

  const timeExpired = now >= activeEpoch.closes_at;
  const maxClaimsReached = activeEpoch.claim_count >= epochMaxClaims;
  const shouldClose = timeExpired || maxClaimsReached;

  if (!shouldClose) {
    return { action: "NOOP", fundId, reason: "epoch still active" };
  }

  if (activeEpoch.claim_count < epochMinClaims) {
    if (timeExpired) {
      const newClosesAt = now + epochDurationMs;
      await extendEpoch({ fundId, epochId: activeEpoch.epoch_id, newClosesAt });
      return { action: "EXTENDED", fundId, epochId: activeEpoch.epoch_id, newClosesAt };
    }
    return { action: "NOOP", fundId, reason: "waiting for minimum claims" };
  }

  try {
    await closeEpoch({ fundId, epochId: activeEpoch.epoch_id });

    const result = await aggregateEpoch(fundId, BigInt(activeEpoch.epoch_id));

    await markEpochAggregated({ fundId, epochId: activeEpoch.epoch_id });

    await publishEvent("epoch:aggregated", fundId, {
      epochId: activeEpoch.epoch_id,
      epochStateHash: result.epochStateHash,
      aggregateWeights: result.aggregateWeights,
      claimCount: result.claimCount,
      participantCount: result.participantCount
    });

    return {
      action: "AGGREGATED",
      fundId,
      epochId: activeEpoch.epoch_id,
      epochStateHash: result.epochStateHash
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { action: "ERROR", fundId, error: message };
  }
}

export async function tickAllFunds(input: {
  nowMs: number;
  limit?: number;
}): Promise<TickResult[]> {
  const funds = await listActionableFunds({ nowMs: input.nowMs, limit: input.limit });
  const results: TickResult[] = [];

  for (const fund of funds) {
    const result = await tickEpoch({
      fundId: fund.fundId,
      epochDurationMs: fund.epochDurationMs,
      epochMinClaims: fund.epochMinClaims,
      epochMaxClaims: fund.epochMaxClaims,
      nowMs: input.nowMs
    });
    results.push(result);
  }

  return results;
}

function isDuplicateOrConflict(error: unknown): boolean {
  const msg = String(
    (error as { message?: string } | null)?.message ?? error ?? ""
  ).toLowerCase();
  return msg.includes("duplicate") || msg.includes("23505") || msg.includes("unique");
}
