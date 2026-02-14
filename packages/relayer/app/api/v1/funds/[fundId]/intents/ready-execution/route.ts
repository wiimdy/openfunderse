import { NextResponse } from "next/server";
import { requireBotAuth } from "@/lib/bot-auth";
import { requireFundBotRole } from "@/lib/fund-bot-authz";
import { listReadyExecutionPayloads } from "@/lib/supabase";

function parseJsonSafe(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ fundId: string }> }
) {
  const { fundId } = await context.params;
  const botAuth = requireBotAuth(request, ["intents.propose"]);
  if (!botAuth.ok) {
    return botAuth.response;
  }

  const membership = await requireFundBotRole({
    fundId,
    botId: botAuth.botId,
    allowedRoles: ["strategy"]
  });
  if (!membership.ok) {
    return membership.response;
  }

  const url = new URL(request.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? "20");
  const offsetRaw = Number(url.searchParams.get("offset") ?? "0");
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.trunc(limitRaw), 100) : 20;
  const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? Math.trunc(offsetRaw) : 0;

  const out = await listReadyExecutionPayloads({
    fundId,
    limit,
    offset
  });

  return NextResponse.json(
    {
      status: "OK",
      endpoint: "GET /api/v1/funds/{fundId}/intents/ready-execution",
      fundId,
      botId: botAuth.botId,
      total: out.total,
      limit,
      offset,
      items: out.rows.map((row) => ({
        jobId: row.job.id,
        intentHash: row.job.intent_hash,
        jobStatus: row.job.status,
        attemptCount: row.job.attempt_count,
        nextRunAt: row.job.next_run_at,
        maxNotional: row.intent.max_notional,
        deadline: row.intent.deadline,
        intent: parseJsonSafe(row.intent.intent_json),
        executionRoute: parseJsonSafe(row.intent.execution_route_json)
      }))
    },
    { status: 200 }
  );
}
