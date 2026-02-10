import { NextResponse } from "next/server";
import { requireBotAuth } from "@/lib/bot-auth";

export async function POST(
  request: Request,
  context: { params: Promise<{ fundId: string }> }
) {
  const { fundId } = await context.params;
  const botAuth = requireBotAuth(request, ["claims.submit"]);
  if (!botAuth.ok) {
    return botAuth.response;
  }

  return NextResponse.json(
    {
      status: "TODO",
      endpoint: "POST /api/v1/funds/{fundId}/claims",
      fundId,
      botId: botAuth.botId,
      message:
        "Claim submission API baseline is scaffolded. Implement schema validation, canonical hashing, persistence, and onchain submit flow."
    },
    { status: 501 }
  );
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ fundId: string }> }
) {
  const { fundId } = await context.params;
  return NextResponse.json(
    {
      status: "TODO",
      endpoint: "GET /api/v1/funds/{fundId}/claims",
      fundId,
      message:
        "Claim read API baseline is scaffolded. Implement filters (status, token, epoch) and pagination."
    },
    { status: 501 }
  );
}
