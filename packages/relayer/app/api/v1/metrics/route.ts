import { NextResponse } from "next/server";
import { getCounters } from "@/lib/metrics";

export async function GET() {
  return NextResponse.json({ status: "OK", metrics: getCounters() }, { status: 200 });
}
