import type { ExecutionJobRow } from "@/lib/supabase";

const shortHex = (value: string, left = 6, right = 4): string => {
  const v = String(value);
  if (v.length <= left + right + 2) return v;
  return `${v.slice(0, left + 2)}…${v.slice(-right)}`;
};

const statusBadgeClass = (status: string): string => {
  if (status === "EXECUTED") return "bg-emerald-50 text-emerald-700";
  if (status === "RUNNING") return "bg-violet-50 text-violet-700";
  if (status === "READY" || status === "READY_FOR_ONCHAIN") return "bg-amber-50 text-amber-700";
  if (status.startsWith("FAILED")) return "bg-red-50 text-red-700";
  return "bg-gray-50 text-gray-700";
};

export function ExecutionTable(props: {
  rows: ExecutionJobRow[];
  total: number;
}) {
  return (
    <div className="rounded-2xl border border-gray-200/60 bg-white p-6">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium text-gray-500">Execution Jobs</h3>
        <span className="text-xs text-gray-400">{props.total} total</span>
      </div>

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
          {props.rows.map((job) => (
            <tr key={job.id} className="border-b border-gray-50 last:border-0">
              <td className="py-2.5 font-mono text-xs text-gray-600">
                {shortHex(job.intent_hash)}
              </td>
              <td className="py-2.5">
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${statusBadgeClass(
                    job.status
                  )}`}
                >
                  {job.status}
                </span>
              </td>
              <td className="py-2.5 text-gray-500">{Number(job.attempt_count ?? 0)}</td>
              <td className="py-2.5 text-right font-mono text-xs text-gray-400">
                {job.tx_hash ? shortHex(job.tx_hash) : "—"}
              </td>
            </tr>
          ))}
          {props.rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="py-8 text-center text-xs text-gray-400">
                No execution jobs yet
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
