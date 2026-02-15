import { NextResponse } from "next/server";
import { requireBotAuth } from "@/lib/bot-auth";
import { isSameAddress, requireFundBotRole } from "@/lib/fund-bot-authz";
import { ingestIntentAttestation } from "@/lib/aggregator";

export async function POST(
  request: Request,
  context: { params: Promise<{ fundId: string }> }
) {
  const { fundId } = await context.params;

  const botAuth = await requireBotAuth(request, ["intents.attest"]);
  if (!botAuth.ok) {
    return botAuth.response;
  }

  const membership = await requireFundBotRole({
    fundId,
    botId: botAuth.botId,
    allowedRoles: ["participant"]
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

  const attestations = Array.isArray(body.attestations)
    ? (body.attestations as Record<string, unknown>[])
    : [body];

  const results = [] as Array<Record<string, unknown>>;
  let hasError = false;

  for (const item of attestations) {
    const claimedVerifier = String(item.verifier ?? "");
    if (!isSameAddress(claimedVerifier, membership.membership.botAddress)) {
      hasError = true;
      results.push({
        ok: false,
        error: "verifier address must match registered bot address",
        expectedVerifier: membership.membership.botAddress,
        receivedVerifier: claimedVerifier,
        status: 403,
        intentHash: item.intentHash ?? null
      });
      continue;
    }

    let result;
    try {
      result = await ingestIntentAttestation({
        fundId,
        intentHash: String(item.intentHash ?? "") as `0x${string}`,
        verifier: String(item.verifier ?? "") as `0x${string}`,
        expiresAt: BigInt(String(item.expiresAt ?? "0")),
        nonce: BigInt(String(item.nonce ?? "0")),
        signature: String(item.signature ?? "") as `0x${string}`
      });
    } catch (error) {
      hasError = true;
      results.push({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        status: 400,
        intentHash: item.intentHash ?? null
      });
      continue;
    }

    if (!result.ok) {
      hasError = true;
      results.push({
        ok: false,
        error: result.error,
        status: result.status,
        intentHash: item.intentHash ?? null
      });
      continue;
    }

    results.push({ ok: true, ...result.data });
  }

  return NextResponse.json(
    {
      status: hasError ? "PARTIAL" : "OK",
      endpoint: "POST /api/v1/funds/{fundId}/intents/attestations/batch",
      fundId,
      botId: botAuth.botId,
      count: results.length,
      results
    },
    { status: hasError ? 207 : 200 }
  );
}
