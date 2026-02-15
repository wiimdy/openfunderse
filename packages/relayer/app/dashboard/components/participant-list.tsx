const shortHex = (value: string, left = 6, right = 4): string => {
  const v = String(value);
  if (!v.startsWith("0x")) return v;
  if (v.length <= left + right + 2) return v;
  return `${v.slice(0, left + 2)}…${v.slice(-right)}`;
};

export function ParticipantList(props: {
  participants: Array<{ address: string; botId?: string; weight?: string }>;
}) {
  return (
    <div className="rounded-2xl border border-gray-200/60 bg-white p-6">
      <h3 className="text-sm font-medium text-gray-500">Participants</h3>
      <div className="mt-4 space-y-3">
        {props.participants.length === 0 ? (
          <p className="text-sm text-gray-400">No active participants.</p>
        ) : null}
        {props.participants.map((p, i) => (
          <div key={`${p.address}:${i}`} className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[11px] font-semibold text-gray-400">
                {i + 1}
              </span>
              <div>
                <p className="font-mono text-xs text-gray-600">{shortHex(p.address)}</p>
                <p className="text-[11px] text-gray-400">{p.botId ?? ""}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

