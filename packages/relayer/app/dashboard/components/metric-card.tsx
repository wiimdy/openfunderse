interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  accent?: 'default' | 'green' | 'amber' | 'red' | 'violet';
}

const accentColors: Record<string, string> = {
  default: 'text-gray-900',
  green: 'text-emerald-600',
  amber: 'text-amber-600',
  red: 'text-red-600',
  violet: 'text-violet-600',
};

export function MetricCard({
  title,
  value,
  subtitle,
  accent = 'default',
}: MetricCardProps) {
  return (
    <div className="rounded-2xl border border-gray-200/60 bg-white p-6">
      <h3 className="text-sm font-medium text-gray-500">{title}</h3>
      <p
        className={`mt-3 text-[2.5rem] font-semibold leading-none tracking-tight ${accentColors[accent]}`}
      >
        {value}
      </p>
      {subtitle && (
        <p className="mt-2 text-[13px] text-gray-400">{subtitle}</p>
      )}
    </div>
  );
}
