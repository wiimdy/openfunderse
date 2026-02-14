import { NextResponse } from "next/server";
import { requireBotAuth } from "@/lib/bot-auth";
import { isSameAddress, requireFundBotRole } from "@/lib/fund-bot-authz";
import { ingestClaimAttestation } from "@/lib/aggregator";

export async function POST(
  request: Request,
  context: { params: Promise<{ fundId: string }> }
) {
  const { fundId } = await context.params;

  const botAuth = requireBotAuth(request, ["claims.attest"]);
  if (!botAuth.ok) {
    return botAuth.response;
  }

  const membership = await requireFundBotRole({
    fundId,
    botId: botAuth.botId,
    allowedRoles: ["verifier"]
  });
  if (!membership.ok) {
    return membership.response;
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }

  const claimedVerifier = String(body.verifier ?? "");
  if (!isSameAddress(claimedVerifier, membership.membership.botAddress)) {
    return NextResponse.json(
      {
        status: "ERROR",
        endpoint: "POST /api/v1/funds/{fundId}/attestations",
        fundId,
        botId: botAuth.botId,
        error: "verifier address must match registered bot address",
        expectedVerifier: membership.membership.botAddress,
        receivedVerifier: claimedVerifier
      },
      { status: 403 }
    );
  }

  let result;
  try {
    result = await ingestClaimAttestation({
      fundId,
      claimHash: String(body.claimHash ?? "") as `0x${string}`,
      epochId: BigInt(String(body.epochId ?? "0")),
      verifier: String(body.verifier ?? "") as `0x${string}`,
      expiresAt: BigInt(String(body.expiresAt ?? "0")),
      nonce: BigInt(String(body.nonce ?? "0")),
      signature: String(body.signature ?? "") as `0x${string}`
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "ERROR",
        endpoint: "POST /api/v1/funds/{fundId}/attestations",
        fundId,
        botId: botAuth.botId,
        error: error instanceof Error ? error.message : String(error)
      },
      { status: 400 }
    );
  }

  if (!result.ok) {
    return NextResponse.json(
      {
        status: "ERROR",
        endpoint: "POST /api/v1/funds/{fundId}/attestations",
        fundId,
        botId: botAuth.botId,
        error: result.error
      },
      { status: result.status }
    );
  }

  return NextResponse.json(
    {
      status: "OK",
      endpoint: "POST /api/v1/funds/{fundId}/attestations",
      fundId,
      botId: botAuth.botId,
      ...result.data
    },
    { status: result.status }
  );
}
