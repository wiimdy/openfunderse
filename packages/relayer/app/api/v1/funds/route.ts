import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/authz";

export async function POST(request: Request) {
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

  const fundName = String(body.fundName ?? "").trim();
  if (!fundName) {
    return NextResponse.json(
      {
        error: "BAD_REQUEST",
        message: "fundName is required."
      },
      { status: 400 }
    );
  }

  return NextResponse.json(
    {
      status: "TODO",
      endpoint: "POST /api/v1/funds",
      admin: admin.email,
      payload: {
        fundName,
        verifierThreshold: body.verifierThreshold ?? null,
        intentThreshold: body.intentThreshold ?? null,
        strategyPolicyUri: body.strategyPolicyUri ?? null
      },
      message:
        "Admin-only fund creation baseline is scaffolded. Persist fund config and wire contract deployment/registry in next step."
    },
    { status: 501 }
  );
}
