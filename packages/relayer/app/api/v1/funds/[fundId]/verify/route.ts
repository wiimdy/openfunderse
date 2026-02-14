import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/authz";
import { getFund, updateFundVerification } from "@/lib/supabase";

export async function POST(
  request: Request,
  context: { params: Promise<{ fundId: string }> }
) {
  const admin = await requireAdminSession();
  if (!admin.ok) {
    return admin.response;
  }

  const { fundId } = await context.params;
  const existing = await getFund(fundId);
  if (!existing) {
    return NextResponse.json(
      {
        error: "NOT_FOUND",
        message: `fund not found: ${fundId}`
      },
      { status: 404 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const isVerified = body.isVerified === undefined ? true : Boolean(body.isVerified);
  const visibilityRaw = String(body.visibility ?? (isVerified ? "PUBLIC" : "HIDDEN")).toUpperCase();
  if (visibilityRaw !== "PUBLIC" && visibilityRaw !== "HIDDEN") {
    return NextResponse.json(
      {
        error: "BAD_REQUEST",
        message: "visibility must be PUBLIC or HIDDEN"
      },
      { status: 400 }
    );
  }

  await updateFundVerification({
    fundId,
    isVerified,
    visibility: visibilityRaw,
    verificationNote: body.verificationNote ? String(body.verificationNote) : null
  });

  return NextResponse.json(
    {
      status: "OK",
      endpoint: "POST /api/v1/funds/{fundId}/verify",
      adminId: admin.adminId,
      fundId,
      isVerified,
      visibility: visibilityRaw
    },
    { status: 200 }
  );
}
