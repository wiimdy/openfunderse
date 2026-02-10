import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/authz";

const ALLOWED_ROLES = new Set(["strategy", "crawler", "verifier"]);

export async function POST(
  request: Request,
  context: { params: Promise<{ fundId: string }> }
) {
  const { fundId } = await context.params;
  const admin = await requireAdminSession();
  if (!admin.ok) {
    return admin.response;
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const role = String(body.role ?? "").trim().toLowerCase();
  const botId = String(body.botId ?? "").trim();
  const botAddress = String(body.botAddress ?? "").trim();

  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json(
      {
        error: "BAD_REQUEST",
        message: "role must be one of: strategy, crawler, verifier"
      },
      { status: 400 }
    );
  }

  if (!botId || !botAddress) {
    return NextResponse.json(
      {
        error: "BAD_REQUEST",
        message: "botId and botAddress are required."
      },
      { status: 400 }
    );
  }

  return NextResponse.json(
    {
      status: "TODO",
      endpoint: "POST /api/v1/funds/{fundId}/bots/register",
      fundId,
      admin: admin.email,
      payload: {
        role,
        botId,
        botAddress,
        policyUri: body.policyUri ?? null,
        telegramHandle: body.telegramHandle ?? null
      },
      message:
        "Admin-only bot registration baseline is scaffolded. Persist role mapping, issue bot API key, and sync allowlist onchain."
    },
    { status: 501 }
  );
}
