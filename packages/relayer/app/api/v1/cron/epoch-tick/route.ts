import { NextResponse } from "next/server";
import { tickAllFunds } from "@/lib/epoch-manager";

export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const provided = request.headers.get("x-cron-secret");
    if (provided !== cronSecret) {
      return NextResponse.json(
        { error: "UNAUTHORIZED", message: "invalid cron secret" },
        { status: 401 }
      );
    }
  }

  const now = Date.now();
  const results = await tickAllFunds({ nowMs: now });

  return NextResponse.json({
    status: "OK",
    endpoint: "POST /api/v1/cron/epoch-tick",
    timestamp: now,
    processed: results.length,
    results
  });
}
