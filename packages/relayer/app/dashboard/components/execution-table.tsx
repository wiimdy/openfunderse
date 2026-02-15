function truncHash(hash: string | null): string {
  if (!hash || hash.length <= 12) return hash || '—';
  return `${hash.slice(0, 8)}\u2026${hash.slice(-4)}`;
}

const statusStyle: Record<string, string> = {
  EXECUTED: 'bg-emerald-50 text-emerald-700',
  READY: 'bg-amber-50 text-amber-700',
  READY_FOR_ONCHAIN: 'bg-amber-50 text-amber-700',
  RUNNING: 'bg-blue-50 text-blue-700',
  FAILED_RETRYABLE: 'bg-red-50 text-red-600',
  FAILED_FINAL: 'bg-red-50 text-red-600',
};

interface ExecutionJob {
  id: number;
  intent_hash: string;
  status: string;
  attempt_count: number;
  tx_hash: string | null;
  created_at: number;
}

interface ExecutionTableProps {
  jobs: ExecutionJob[];
  total: number;
}

export function ExecutionTable({ jobs, total }: ExecutionTableProps) {
  return (
    <div className="rounded-2xl border border-gray-200/60 bg-white p-6">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium text-gray-500">Execution Jobs</h3>
        <span className="text-xs text-gray-400">{total} total</span>
      </div>
      {jobs.length === 0 ? (
        <p className="mt-6 text-center text-sm text-gray-300">
          No execution jobs
        </p>
      ) : (
        <table className="mt-4 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-xs font-medium text-gray-400">
              <th className="pb-2">Intent</th>
              <th className="pb-2">Status</th>
              <th className="pb-2">Attempts</th>
              <th className="pb-2 text-right">Tx</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr
                key={j.id}
                className="border-b border-gray-50 last:border-0"
              >
                <td className="py-2.5 font-mono text-xs text-gray-600">
                  {truncHash(j.intent_hash)}
                </td>
                <td className="py-2.5">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${statusStyle[j.status] ?? 'bg-gray-50 text-gray-500'}`}
                  >
                    {j.status}
                  </span>
                </td>
                <td className="py-2.5 text-gray-500">{j.attempt_count}</td>
                <td className="py-2.5 text-right font-mono text-xs text-gray-400">
                  {truncHash(j.tx_hash)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
