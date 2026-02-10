import { NextResponse } from "next/server";
import { requireBotAuth } from "@/lib/bot-auth";

export async function POST(
  request: Request,
  context: { params: Promise<{ fundId: string }> }
) {
  const { fundId } = await context.params;
  const botAuth = requireBotAuth(request, ["claims.attest"]);
  if (!botAuth.ok) {
    return botAuth.response;
  }

  return NextResponse.json(
    {
      status: "TODO",
      endpoint: "POST /api/v1/funds/{fundId}/attestations",
      fundId,
      botId: botAuth.botId,
      message:
        "Claim attestation ingestion API baseline is scaffolded. Implement claimHash re-computation, EIP-712 signature checks, and duplicate attestation guards."
    },
    { status: 501 }
  );
}
