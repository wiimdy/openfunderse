import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      status: "DISABLED",
      endpoint: "POST /api/v1/funds/bootstrap",
      message: "Onchain fund deployment via relayer is disabled."
    },
    { status: 410 }
  );
}
