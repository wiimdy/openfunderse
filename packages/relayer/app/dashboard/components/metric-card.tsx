export function MetricCard(props: {
  title: string;
  value: string | number;
  note: string;
  accent?: "VIOLET" | "EMERALD" | "AMBER" | "RED" | "GRAY";
}) {
  const accentClass =
    props.accent === "VIOLET"
      ? "text-violet-600"
      : props.accent === "EMERALD"
        ? "text-emerald-600"
        : props.accent === "AMBER"
          ? "text-amber-600"
          : props.accent === "RED"
            ? "text-red-600"
            : "text-gray-900";

  return (
    <div className="rounded-2xl border border-gray-200/60 bg-white p-6">
      <h3 className="text-sm font-medium text-gray-500">{props.title}</h3>
      <p
        className={`mt-3 text-[2.5rem] font-semibold leading-none tracking-tight ${accentClass}`}
      >
        {props.value}
      </p>
      <p className="mt-2 text-[13px] text-gray-400">{props.note}</p>
    </div>
  );
}

