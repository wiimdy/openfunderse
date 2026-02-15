function truncHash(hash: string): string {
  if (!hash || hash.length <= 12) return hash || '—';
  return `${hash.slice(0, 8)}\u2026${hash.slice(-4)}`;
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 0) return 'just now';
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface Claim {
  id: number;
  claim_hash: string;
  epoch_id: string;
  participant: string;
  created_at: number;
}

interface ClaimsTableProps {
  claims: Claim[];
  total: number;
}

export function ClaimsTable({ claims, total }: ClaimsTableProps) {
  return (
    <div className="rounded-2xl border border-gray-200/60 bg-white p-6">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium text-gray-500">Recent Claims</h3>
        <span className="text-xs text-gray-400">{total} total</span>
      </div>
      {claims.length === 0 ? (
        <p className="mt-6 text-center text-sm text-gray-300">No claims yet</p>
      ) : (
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
            {claims.map((c) => (
              <tr
                key={c.id}
                className="border-b border-gray-50 last:border-0"
              >
                <td className="py-2.5 font-mono text-xs text-gray-600">
                  {truncHash(c.claim_hash)}
                </td>
                <td className="py-2.5 text-gray-600">#{c.epoch_id}</td>
                <td className="py-2.5 font-mono text-xs text-gray-600">
                  {truncHash(c.participant)}
                </td>
                <td className="py-2.5 text-right text-xs text-gray-400">
                  {timeAgo(c.created_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
