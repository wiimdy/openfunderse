import { NextResponse } from "next/server";
import { buildCanonicalSnapshotRecord } from "@claw/protocol-sdk";
import {
  getApprovedClaimHashesByFund,
  getLatestSnapshot,
  upsertSnapshot
} from "@/lib/supabase";

export async function GET(
  _request: Request,
  context: { params: Promise<{ fundId: string }> }
) {
  const { fundId } = await context.params;

  let snapshot = await getLatestSnapshot(fundId);

  if (!snapshot) {
    const approved = await getApprovedClaimHashesByFund(fundId);
    if (approved.length > 0) {
      const latestEpoch = approved.reduce(
        (max, row) => (row.epochId > max ? row.epochId : max),
        approved[0].epochId
      );
      const claimHashes = approved
        .filter((row) => row.epochId === latestEpoch)
        .map((row) => row.claimHash as `0x${string}`);

      const built = buildCanonicalSnapshotRecord({
        epochId: latestEpoch,
        claimHashes
      });

      await upsertSnapshot({
        fundId,
        epochId: built.epochId,
        snapshotHash: built.snapshotHash,
        claimHashes
      });

      snapshot = await getLatestSnapshot(fundId);
    }
  }

  return NextResponse.json(
    {
      status: "OK",
      endpoint: "GET /api/v1/funds/{fundId}/snapshots/latest",
      fundId: fundId,
      snapshot: snapshot
        ? {
            epochId: snapshot.epoch_id,
            snapshotHash: snapshot.snapshot_hash,
            claimHashes: JSON.parse(snapshot.claim_hashes_json),
            claimCount: snapshot.claim_count,
            finalizedAt: snapshot.finalized_at
          }
        : null
    },
    { status: 200 }
  );
}
