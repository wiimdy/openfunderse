import { notFound } from 'next/navigation';
import {
  getFund,
  getFundDeployment,
  getStatusSummary,
  getActiveEpoch,
  listAllocationClaimsByFund,
  listExecutionJobs,
  listActiveFundParticipants,
  listStakeWeightsByFund,
} from '@/lib/supabase';
import { getCounters } from '@/lib/metrics';
import { MetricCard } from '../components/metric-card';
import { ClaimsTable } from '../components/claims-table';
import { ExecutionTable } from '../components/execution-table';
import { DeploymentCard } from '../components/deployment-card';
import { ParticipantList } from '../components/participant-list';

export const dynamic = 'force-dynamic';

export default async function FundDashboard({
  params,
}: {
  params: Promise<{ fundId: string }>;
}) {
  const { fundId } = await params;

  const fund = await getFund(fundId);
  if (!fund) notFound();

  const [deployment, summary, activeEpoch, claims, executions, bots, weights] =
    await Promise.all([
      getFundDeployment(fundId),
      getStatusSummary(fundId),
      getActiveEpoch(fundId),
      listAllocationClaimsByFund({ fundId, limit: 10, offset: 0 }),
      listExecutionJobs({ fundId, limit: 10, offset: 0 }),
      listActiveFundParticipants(fundId),
      listStakeWeightsByFund(fundId),
    ]);

  const metrics = getCounters();

  const weightMap = new Map(
    weights.map((w) => [w.participant.toLowerCase(), w.weight.toString()])
  );
  const participants = bots.map((b) => ({
    address: b.bot_address,
    botId: b.bot_id,
    weight: weightMap.get(b.bot_address.toLowerCase()) ?? '0',
  }));

  const epochLabel = activeEpoch
    ? `#${activeEpoch.epoch_id}`
    : summary.allocations.latestEpoch
      ? `#${summary.allocations.latestEpoch.epochId}`
      : '—';
  const epochSub = activeEpoch
    ? `${activeEpoch.status} \u00b7 ${activeEpoch.claim_count} claims`
    : 'No active epoch';

  const executedCount = executions.rows.filter(
    (j) => j.status === 'EXECUTED'
  ).length;
  const runningCount = executions.rows.filter(
    (j) => j.status === 'READY' || j.status === 'RUNNING'
  ).length;
  const execSub =
    executions.total === 0
      ? 'No jobs'
      : `${executedCount} done \u00b7 ${runningCount} pending`;

  return (
    <div>
      <div className="flex items-baseline gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
          {fund.fund_name}
        </h1>
        <span className="text-sm text-gray-400">{fundId}</span>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          title="Total Claims"
          value={summary.allocations.claimCount}
          subtitle="All epochs"
        />
        <MetricCard
          title="Active Epoch"
          value={epochLabel}
          subtitle={epochSub}
          accent="violet"
        />
        <MetricCard
          title="Intents Approved"
          value={summary.intents.approved}
          subtitle={`${summary.intents.pending} pending`}
          accent="green"
        />

        <MetricCard
          title="Participants"
          value={bots.length}
          subtitle="Active bots"
        />
        <MetricCard
          title="Execution Jobs"
          value={executions.total}
          subtitle={execSub}
          accent={runningCount > 0 ? 'amber' : 'default'}
        />
        <MetricCard
          title="API Requests"
          value={metrics.requests_total}
          subtitle={`${metrics.verify_success} verified \u00b7 ${metrics.verify_fail} failed`}
        />

        <div className="sm:col-span-2">
          <ClaimsTable claims={claims.rows} total={claims.total} />
        </div>
        <DeploymentCard deployment={deployment ?? null} />

        <div className="sm:col-span-2">
          <ExecutionTable jobs={executions.rows} total={executions.total} />
        </div>
        <ParticipantList participants={participants} />
      </div>
    </div>
  );
}
