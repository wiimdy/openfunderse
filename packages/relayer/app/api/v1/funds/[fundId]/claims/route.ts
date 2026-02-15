import { NextResponse } from "next/server";
import { requireBotAuth } from "@/lib/bot-auth";
import { isSameAddress, requireFundBotRole } from "@/lib/fund-bot-authz";
import {
  buildCanonicalAllocationClaimRecord,
  type AllocationClaimV1
} from "@claw/protocol-sdk";
import {
  getFund,
  getEpochStateByEpoch,
  insertAllocationClaim,
  listAllocationClaimsByFund
} from "@/lib/supabase";

export async function POST(
  request: Request,
  context: { params: Promise<{ fundId: string }> }
) {
  const { fundId } = await context.params;
  const botAuth = await requireBotAuth(request, ["claims.submit"]);
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

  const raw = (body.claim ?? body.allocationClaim) as Record<string, unknown> | undefined;
  if (!raw) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "claim is required" },
      { status: 400 }
    );
  }

  let claim: AllocationClaimV1;
  try {
    claim = {
      claimVersion: String(raw.claimVersion ?? "v1") as "v1",
      fundId: String(raw.fundId ?? fundId),
      epochId: BigInt(String(raw.epochId ?? "0")),
      participant: String(raw.participant ?? "") as `0x${string}`,
      targetWeights: Array.isArray(raw.targetWeights)
        ? raw.targetWeights.map((value) => BigInt(String(value)))
        : [],
      horizonSec: BigInt(String(raw.horizonSec ?? "0")),
      nonce: BigInt(String(raw.nonce ?? "0")),
      submittedAt: BigInt(String(raw.submittedAt ?? Math.floor(Date.now() / 1000)))
    };
  } catch (error) {
    return NextResponse.json(
      {
        error: "BAD_REQUEST",
        message: error instanceof Error ? `invalid claim payload: ${error.message}` : "invalid claim payload"
      },
      { status: 400 }
    );
  }

  if (claim.fundId !== fundId) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "claim.fundId must match request fundId" },
      { status: 400 }
    );
  }

  if (!isSameAddress(claim.participant, membership.membership.botAddress)) {
    return NextResponse.json(
      {
        error: "FORBIDDEN",
        message: "claim.participant must match registered participant bot address",
        expectedParticipant: membership.membership.botAddress,
        receivedParticipant: claim.participant
      },
      { status: 403 }
    );
  }

  const existingEpoch = await getEpochStateByEpoch({
    fundId,
    epochId: claim.epochId
  });
  if (existingEpoch) {
    return NextResponse.json(
      {
        error: "CONFLICT",
        message: `epoch ${claim.epochId} is already aggregated; claims are no longer accepted`,
        epochId: claim.epochId.toString()
      },
      { status: 409 }
    );
  }

  let record;
  try {
    record = buildCanonicalAllocationClaimRecord({ claim });
  } catch (error) {
    return NextResponse.json(
      {
        error: "BAD_REQUEST",
        message: error instanceof Error ? error.message : String(error)
      },
      { status: 400 }
    );
  }

  const inserted = await insertAllocationClaim({
    fundId,
    claimHash: record.claimHash,
    epochId: record.claim.epochId,
    participant: record.claim.participant,
    claimJson: JSON.stringify(record.claim, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
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

  return NextResponse.json(
    {
      status: "OK",
      endpoint: "POST /api/v1/funds/{fundId}/claims",
      fundId,
      botId: botAuth.botId,
      claimHash: record.claimHash,
      epochId: record.claim.epochId.toString(),
      participant: record.claim.participant
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
  const epochIdRaw = url.searchParams.get("epochId");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "20"), 100);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? "0"), 0);

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

  const result = await listAllocationClaimsByFund({
    fundId,
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
        participant: row.participant,
        claim: JSON.parse(row.claim_json),
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
