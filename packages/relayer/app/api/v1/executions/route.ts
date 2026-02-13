import { NextResponse } from "next/server";
import {
  listExecutionJobs,
  type ExecutionJobStatus
} from "@/lib/sqlite";

const ALLOWED: ReadonlySet<string> = new Set([
  "READY",
  "RUNNING",
  "EXECUTED",
  "FAILED_RETRYABLE",
  "FAILED_FINAL"
]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const fundId = url.searchParams.get("fundId") ?? undefined;
  const statusRaw = (url.searchParams.get("status") ?? "").toUpperCase();
  const status = ALLOWED.has(statusRaw)
    ? (statusRaw as ExecutionJobStatus)
    : undefined;
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "20"), 100);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? "0"), 0);

  const out = await listExecutionJobs({
    fundId,
    status,
    limit: Number.isFinite(limit) && limit > 0 ? limit : 20,
    offset: Number.isFinite(offset) && offset >= 0 ? offset : 0
  });

  return NextResponse.json(
    {
      status: "OK",
      endpoint: "GET /api/v1/executions",
      filters: { fundId: fundId ?? null, status: status ?? null },
      total: out.total,
      limit,
      offset,
      jobs: out.rows
    },
    { status: 200 }
  );
}
