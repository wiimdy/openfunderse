import { NextResponse } from "next/server";
import { runExecutionCron } from "@/lib/executor";

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true;
  const bearer = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-cron-secret");
  return bearer === `Bearer ${cronSecret}` || cronHeader === cronSecret;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { error: "FORBIDDEN", message: "cron secret invalid" },
      { status: 403 }
    );
  }

  const out = await runExecutionCron();
  return NextResponse.json(
    {
      status: "OK",
      endpoint: "POST /api/v1/cron/execute-intents",
      ...out
    },
    { status: 200 }
  );
}
