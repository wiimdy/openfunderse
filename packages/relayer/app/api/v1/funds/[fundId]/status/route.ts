import { NextResponse } from "next/server";
import { buildValidatorWeightMap, totalValidatorWeight } from "@claw/protocol-sdk";
import { getCounters } from "@/lib/metrics";
import { getStatusSummary } from "@/lib/sqlite";
import { loadReadOnlyRuntimeConfig } from "@/lib/config";

export async function GET(
  _request: Request,
  context: { params: Promise<{ fundId: string }> }
) {
  const { fundId } = await context.params;
  const cfg = loadReadOnlyRuntimeConfig();
  const snapshotTotalWeight =
    cfg.validatorWeights.length > 0
      ? totalValidatorWeight(buildValidatorWeightMap(cfg.validatorWeights))
      : BigInt(0);

  return NextResponse.json(
    {
      status: "OK",
      endpoint: "GET /api/v1/funds/{fundId}/status",
      fundId,
      summary: await getStatusSummary(fundId),
      weightedConfig: {
        claimThresholdWeight: cfg.claimThresholdWeight.toString(),
        intentThresholdWeight: cfg.intentThresholdWeight.toString(),
        validatorSnapshotTotalWeight: snapshotTotalWeight.toString()
      },
      metrics: getCounters()
    },
    { status: 200 }
  );
}
