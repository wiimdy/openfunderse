function truncAddr(addr: string): string {
  if (!addr || addr.length <= 12) return addr || '—';
  return `${addr.slice(0, 8)}\u2026${addr.slice(-4)}`;
}

interface Participant {
  address: string;
  botId: string;
  weight: string;
}

interface ParticipantListProps {
  participants: Participant[];
}

export function ParticipantList({ participants }: ParticipantListProps) {
  return (
    <div className="rounded-2xl border border-gray-200/60 bg-white p-6">
      <h3 className="text-sm font-medium text-gray-500">Participants</h3>
      {participants.length === 0 ? (
        <p className="mt-6 text-center text-sm text-gray-300">
          No participants
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {participants.map((p, i) => (
            <div
              key={p.address}
              className="flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[11px] font-semibold text-gray-400">
                  {i + 1}
                </span>
                <div>
                  <p className="font-mono text-xs text-gray-600">
                    {truncAddr(p.address)}
                  </p>
                  <p className="text-[11px] text-gray-400">{p.botId}</p>
                </div>
              </div>
              {p.weight !== '0' && (
                <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-600">
                  w:{p.weight}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
