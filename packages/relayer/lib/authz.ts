import { NextResponse } from "next/server";
import { auth } from "@/app/auth";

function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function isAdminEmail(email: string): boolean {
  const admins = parseCsv(process.env.ADMIN_EMAILS);
  if (admins.length === 0) {
    return false;
  }

  return admins.includes(email.trim().toLowerCase());
}

export async function requireAdminSession() {
  const session = await auth();
  const email = session?.user?.email;

  if (!email || !isAdminEmail(email)) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          error: "FORBIDDEN",
          message: "Admin session is required.",
          hint: "Set ADMIN_EMAILS in relayer env and sign in with one of those accounts."
        },
        { status: 403 }
      )
    };
  }

  return {
    ok: true as const,
    session,
    email
  };
}
