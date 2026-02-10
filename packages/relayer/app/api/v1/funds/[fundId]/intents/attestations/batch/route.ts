import { NextResponse } from "next/server";
import { requireBotAuth } from "@/lib/bot-auth";

export async function POST(
  request: Request,
  context: { params: Promise<{ fundId: string }> }
) {
  const { fundId } = await context.params;
  const botAuth = requireBotAuth(request, ["intents.attest"]);
  if (!botAuth.ok) {
    return botAuth.response;
  }

  return NextResponse.json(
    {
      status: "TODO",
      endpoint: "POST /api/v1/funds/{fundId}/intents/attestations/batch",
      fundId,
      botId: botAuth.botId,
      message:
        "Intent attestation batch API baseline is scaffolded. Implement signature verification and onchain attestIntent submission."
    },
    { status: 501 }
  );
}
