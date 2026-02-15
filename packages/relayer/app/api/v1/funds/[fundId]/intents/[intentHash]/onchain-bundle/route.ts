import { NextResponse } from "next/server";
import { requireBotAuthAsync } from "@/lib/bot-auth";
import { requireFundBotRole } from "@/lib/fund-bot-authz";
import { getIntentAttestationBundle } from "@/lib/supabase";

export async function GET(
  request: Request,
  context: { params: Promise<{ fundId: string; intentHash: string }> }
) {
  const { fundId, intentHash } = await context.params;
  const botAuth = await requireBotAuthAsync(request, ["intents.propose"]);
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

  const bundle = await getIntentAttestationBundle({
    fundId,
    intentHash
  });
  if (!bundle) {
    return NextResponse.json(
      {
        error: "NOT_FOUND",
        message: "intent attestation bundle not found",
        fundId,
        intentHash
      },
      { status: 404 }
    );
  }

  const thresholdWeight = BigInt(bundle.thresholdWeight);
  const attestedWeight = BigInt(bundle.attestedWeight);

  return NextResponse.json(
    {
      status: "OK",
      endpoint: "GET /api/v1/funds/{fundId}/intents/{intentHash}/onchain-bundle",
      fundId,
      botId: botAuth.botId,
      intentHash: bundle.subjectHash,
      subjectState: bundle.stateStatus,
      thresholdWeight: bundle.thresholdWeight,
      attestedWeight: bundle.attestedWeight,
      thresholdReached: attestedWeight >= thresholdWeight,
      verifiers: bundle.verifiers,
      signatures: bundle.signatures,
      attestations: bundle.attestations
    },
    { status: 200 }
  );
}
