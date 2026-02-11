import { NextResponse } from "next/server";
import { auth } from "@/app/auth";

function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function isAdminId(id: string): boolean {
  const fromIds = parseCsv(process.env.ADMIN_IDS);
  const fromLegacyEmails = parseCsv(process.env.ADMIN_EMAILS);
  const fallback = process.env.ADMIN_LOGIN_ID
    ? [process.env.ADMIN_LOGIN_ID.trim().toLowerCase()]
    : [];
  const admins =
    fromIds.length > 0 ? fromIds : fromLegacyEmails.length > 0 ? fromLegacyEmails : fallback;
  if (admins.length === 0) {
    return false;
  }

  return admins.includes(id.trim().toLowerCase());
}

export async function requireAdminSession() {
  const session = await auth();
  const adminId = (session?.user?.name ?? session?.user?.email ?? "").trim();

  if (!adminId || !isAdminId(adminId)) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          error: "FORBIDDEN",
          message: "Admin session is required.",
          hint: "Set ADMIN_LOGIN_ID (and optionally ADMIN_IDS) in relayer env and sign in with that ID."
        },
        { status: 403 }
      )
    };
  }

  return {
    ok: true as const,
    session,
    adminId
  };
}
