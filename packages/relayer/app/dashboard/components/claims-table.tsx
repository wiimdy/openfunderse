import type { AllocationClaimRow } from "@/lib/supabase";

const formatRelativeTime = (ms: number): string => {
  const deltaSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (deltaSec < 60) return `${deltaSec}s ago`;
  const deltaMin = Math.floor(deltaSec / 60);
  if (deltaMin < 60) return `${deltaMin}m ago`;
  const deltaHr = Math.floor(deltaMin / 60);
  if (deltaHr < 24) return `${deltaHr}h ago`;
  const deltaDay = Math.floor(deltaHr / 24);
  return `${deltaDay}d ago`;
};

const shortHex = (value: string, left = 6, right = 4): string => {
  const v = String(value);
  if (v.length <= left + right + 2) return v;
  return `${v.slice(0, left + 2)}…${v.slice(-right)}`;
};

export function ClaimsTable(props: { rows: AllocationClaimRow[]; total: number }) {
  return (
    <div className="rounded-2xl border border-gray-200/60 bg-white p-6">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium text-gray-500">Recent Claims</h3>
        <span className="text-xs text-gray-400">{props.total} total</span>
      </div>

      <table className="mt-4 w-full text-left text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-xs font-medium text-gray-400">
            <th className="pb-2">Hash</th>
            <th className="pb-2">Epoch</th>
            <th className="pb-2">Participant</th>
            <th className="pb-2 text-right">Time</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <tr key={row.id} className="border-b border-gray-50 last:border-0">
              <td className="py-2.5 font-mono text-xs text-gray-600">
                {shortHex(row.claim_hash)}
              </td>
              <td className="py-2.5 text-gray-600">#{String(row.epoch_id)}</td>
              <td className="py-2.5 font-mono text-xs text-gray-600">
                {shortHex(row.participant)}
              </td>
              <td className="py-2.5 text-right text-xs text-gray-400">
                {formatRelativeTime(Number(row.created_at))}
              </td>
            </tr>
          ))}
          {props.rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="py-8 text-center text-xs text-gray-400">
                No claims yet
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

