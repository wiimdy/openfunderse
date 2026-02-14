import { NextResponse } from "next/server";
import { buildValidatorWeightMap, totalValidatorWeight } from "@claw/protocol-sdk";
import { getCounters } from "@/lib/metrics";
import { getFundDeployment, getStatusSummary } from "@/lib/supabase";
import { loadReadOnlyRuntimeConfig } from "@/lib/config";

export async function GET(
  _request: Request,
  context: { params: Promise<{ fundId: string }> }
) {
  const { fundId } = await context.params;
  const cfg = loadReadOnlyRuntimeConfig();
  const deployment = await getFundDeployment(fundId);
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
        intentThresholdWeight: cfg.intentThresholdWeight.toString(),
        validatorSnapshotTotalWeight: snapshotTotalWeight.toString()
      },
      onchainDeployment: deployment
        ? {
            chainId: deployment.chain_id,
            factoryAddress: deployment.factory_address,
            onchainFundId: deployment.onchain_fund_id,
            intentBookAddress: deployment.intent_book_address,
            clawCoreAddress: deployment.claw_core_address,
            clawVaultAddress: deployment.claw_vault_address,
            fundOwnerAddress: deployment.fund_owner_address,
            strategyAgentAddress: deployment.strategy_agent_address,
            snapshotBookAddress: deployment.snapshot_book_address,
            assetAddress: deployment.asset_address,
            deployTxHash: deployment.deploy_tx_hash,
            deployBlockNumber: deployment.deploy_block_number,
            deployerAddress: deployment.deployer_address,
            updatedAt: deployment.updated_at
          }
        : null,
      metrics: getCounters()
    },
    { status: 200 }
  );
}
