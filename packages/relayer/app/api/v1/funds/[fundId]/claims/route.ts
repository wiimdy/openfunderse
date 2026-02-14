import { NextResponse } from "next/server";
import { requireBotAuth } from "@/lib/bot-auth";
import { isSameAddress, requireFundBotRole } from "@/lib/fund-bot-authz";
import {
  buildCanonicalClaimRecord,
  type ClaimPayload
} from "@claw/protocol-sdk";
import {
  getFund,
  insertClaim,
  listClaimsByFund,
  upsertSubjectState
} from "@/lib/supabase";

export async function POST(
  request: Request,
  context: { params: Promise<{ fundId: string }> }
) {
  const { fundId } = await context.params;
  const botAuth = requireBotAuth(request, ["claims.submit"]);
  if (!botAuth.ok) {
    return botAuth.response;
  }

  const fund = await getFund(fundId);
  if (!fund) {
    return NextResponse.json(
      { error: "NOT_FOUND", message: `fund not found: ${fundId}` },
      { status: 404 }
    );
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
    return NextResponse.json({ error: "BAD_REQUEST", message: "invalid json body" }, { status: 400 });
  }

  const claimPayload = (body.claimPayload ?? body.payload) as ClaimPayload | undefined;
  const epochIdRaw = body.epochId ?? body.epoch_id;
  let epochId: bigint;
  try {
    epochId = BigInt(String(epochIdRaw ?? "0"));
  } catch {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "epochId must be an integer" },
      { status: 400 }
    );
  }

  if (!claimPayload) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "claimPayload is required" },
      { status: 400 }
    );
  }
  const claimedCrawler = String(claimPayload.crawler ?? "");
  if (!isSameAddress(claimedCrawler, membership.membership.botAddress)) {
    return NextResponse.json(
      {
        error: "FORBIDDEN",
        message: "claimPayload.crawler must match registered participant bot address",
        expectedCrawler: membership.membership.botAddress,
        receivedCrawler: claimedCrawler
      },
      { status: 403 }
    );
  }

  let record;
  try {
    record = buildCanonicalClaimRecord({
      payload: claimPayload,
      epochId
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "BAD_REQUEST",
        message: error instanceof Error ? error.message : String(error)
      },
      { status: 400 }
    );
  }

  const inserted = await insertClaim({
    fundId,
    claimHash: record.claimHash,
    epochId: record.epochId,
    payloadJson: JSON.stringify(record.payload),
    createdBy: botAuth.botId
  });

  if (!inserted.ok) {
    return NextResponse.json(
      {
        error: "CONFLICT",
        message: "duplicate claimHash",
        claimHash: record.claimHash
      },
      { status: 409 }
    );
  }

  await upsertSubjectState({
    fundId,
    subjectType: "CLAIM",
    subjectHash: record.claimHash,
    epochId: record.epochId,
    thresholdWeight: BigInt(fund.verifier_threshold_weight)
  });

  return NextResponse.json(
    {
      status: "OK",
      endpoint: "POST /api/v1/funds/{fundId}/claims",
      fundId,
      botId: botAuth.botId,
      epochId: record.epochId.toString(),
      claimHash: record.claimHash
    },
    { status: 200 }
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ fundId: string }> }
) {
  const { fundId } = await context.params;
  const url = new URL(request.url);
  const statusRaw = (url.searchParams.get("status") ?? "").toUpperCase();
  const epochIdRaw = url.searchParams.get("epochId");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "20"), 100);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? "0"), 0);

  const status =
    statusRaw === "PENDING" || statusRaw === "APPROVED" || statusRaw === "REJECTED"
      ? statusRaw
      : undefined;

  let epochId: bigint | undefined;
  if (epochIdRaw) {
    try {
      epochId = BigInt(epochIdRaw);
    } catch {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "epochId must be an integer" },
        { status: 400 }
      );
    }
  }

  const result = await listClaimsByFund({
    fundId,
    status: status as "PENDING" | "APPROVED" | "REJECTED" | undefined,
    epochId,
    limit: Number.isFinite(limit) && limit > 0 ? limit : 20,
    offset: Number.isFinite(offset) ? offset : 0
  });

  return NextResponse.json(
    {
      status: "OK",
      endpoint: "GET /api/v1/funds/{fundId}/claims",
      fundId,
      claims: result.rows.map((row) => ({
        id: row.id,
        claimHash: row.claim_hash,
        epochId: row.epoch_id,
        status: row.status,
        attestedWeight: row.attested_weight,
        thresholdWeight: row.threshold_weight,
        attestationCount: row.attestation_count,
        payload: JSON.parse(row.payload_json),
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })),
      total: result.total,
      limit,
      offset
    },
    { status: 200 }
  );
}
