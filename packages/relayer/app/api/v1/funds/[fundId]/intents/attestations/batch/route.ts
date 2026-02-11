import { NextResponse } from "next/server";
import { requireBotAuth } from "@/lib/bot-auth";
import { ingestIntentAttestation } from "@/lib/aggregator";

export async function POST(
  request: Request,
  context: { params: Promise<{ fundId: string }> }
) {
  const { fundId } = await context.params;

  const botAuth = requireBotAuth(request, ["intents.attest"]);
  if (!botAuth.ok) {
    return botAuth.response;
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
