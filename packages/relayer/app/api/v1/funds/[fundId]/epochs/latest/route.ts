import { NextResponse } from "next/server";
import { getLatestEpochState } from "@/lib/supabase";

export async function GET(
  _request: Request,
  context: { params: Promise<{ fundId: string }> }
) {
  const { fundId } = await context.params;
  const latest = await getLatestEpochState(fundId);

  return NextResponse.json(
    {
      status: "OK",
      endpoint: "GET /api/v1/funds/{fundId}/epochs/latest",
      fundId,
      epochState: latest
        ? {
            epochId: latest.epoch_id,
            epochStateHash: latest.epoch_state_hash,
            aggregateWeights: JSON.parse(latest.aggregate_weights_json),
            claimHashes: JSON.parse(latest.claim_hashes_json),
            claimCount: latest.claim_count,
            finalizedAt: latest.finalized_at
          }
        : null
    },
    { status: 200 }
  );
}
