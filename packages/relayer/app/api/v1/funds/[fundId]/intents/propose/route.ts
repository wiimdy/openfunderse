import { NextResponse } from "next/server";
import { requireBotAuth } from "@/lib/bot-auth";

export async function POST(
  request: Request,
  context: { params: Promise<{ fundId: string }> }
) {
  const { fundId } = await context.params;
  const botAuth = requireBotAuth(request, ["intents.propose"]);
  if (!botAuth.ok) {
    return botAuth.response;
  }

  return NextResponse.json(
    {
      status: "TODO",
      endpoint: "POST /api/v1/funds/{fundId}/intents/propose",
      fundId: fundId,
      botId: botAuth.botId,
      message:
        "Intent proposal API baseline is scaffolded. Implement snapshot linkage checks, risk-constraint checks, and intentHash persistence."
    },
    { status: 501 }
  );
}
