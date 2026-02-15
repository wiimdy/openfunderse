import { notFound } from "next/navigation";

import { ClaimsTable } from "@/app/dashboard/components/claims-table";
import { DeploymentCard } from "@/app/dashboard/components/deployment-card";
import { ExecutionTable } from "@/app/dashboard/components/execution-table";
import { MetricCard } from "@/app/dashboard/components/metric-card";
import { ParticipantList } from "@/app/dashboard/components/participant-list";
import {
  getActiveEpoch,
  getFund,
  getFundDeployment,
  getStatusSummary,
  listActiveFundParticipants,
  listAllocationClaimsByFund,
  listExecutionJobs,
  listStakeWeightsByFund,
} from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function FundDashboard(props: { params: Promise<{ fundId: string }> }) {
  const { fundId } = await props.params;

  const [
    fund,
    deployment,
    status,
    activeEpoch,
    claims,
    jobs,
    participants,
    stakeWeights
  ] = await Promise.all([
    getFund(fundId),
    getFundDeployment(fundId),
    getStatusSummary(fundId),
    getActiveEpoch(fundId),
    listAllocationClaimsByFund({ fundId, limit: 10, offset: 0 }),
    listExecutionJobs({ fundId, limit: 10, offset: 0 }),
    listActiveFundParticipants(fundId),
    listStakeWeightsByFund(fundId)
  ]);

  if (!fund) return notFound();

  const participantCards = participants.map((p) => {
    const weight = stakeWeights.find((w) => w.participant === String(p.bot_address).toLowerCase());
    return {
      address: p.bot_address,
      botId: p.bot_id,
      weight: weight ? weight.weight.toString() : undefined
    };
  });

  return (
    <div>
      <div className="flex items-baseline gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{fund.fund_name}</h1>
        <span className="text-sm text-gray-400">{fund.fund_id}</span>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          title="Total Claims"
          value={status.allocations.claimCount}
          note="All epochs"
          accent="GRAY"
        />
        <MetricCard
          title="Active Epoch"
          value={activeEpoch ? `#${activeEpoch.epoch_id}` : "#1"}
          note={activeEpoch ? `Closes at ${new Date(activeEpoch.closes_at).toLocaleString()}` : "No active epoch"}
          accent="VIOLET"
        />
        <MetricCard
          title="Intents Approved"
          value={status.intents.approved}
          note={`${status.intents.pending} pending`}
          accent="EMERALD"
        />
        <MetricCard
          title="Participants"
          value={participants.length}
          note="Active bots"
          accent="GRAY"
        />
        <MetricCard
          title="Execution Jobs"
          value={jobs.total}
          note={`${jobs.rows.filter((j) => j.status === "EXECUTED").length} done · ${jobs.rows.filter((j) => j.status === "READY" || j.status === "READY_FOR_ONCHAIN").length} pending`}
          accent="GRAY"
        />
        <MetricCard title="API Requests" value={0} note="0 verified · 0 failed" accent="GRAY" />

        <div className="sm:col-span-2">
          <ClaimsTable rows={claims.rows} total={claims.total} />
        </div>

        <DeploymentCard deployment={deployment} />

        <div className="sm:col-span-2">
          <ExecutionTable rows={jobs.rows} total={jobs.total} />
        </div>

        <ParticipantList participants={participantCards} />
      </div>
    </div>
  );
}
