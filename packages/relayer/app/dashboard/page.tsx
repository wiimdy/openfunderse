import { redirect } from 'next/navigation';
import { listPublicFunds } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export default async function DashboardIndex() {
  const funds = await listPublicFunds({ limit: 50, offset: 0 });

  if (funds.length === 0) {
    return (
      <div className="py-20 text-center">
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
        <p className="mt-3 text-sm text-gray-400">
          No verified funds found. Create and verify a fund to see it here.
        </p>
      </div>
    );
  }

  if (funds.length === 1) {
    redirect(`/dashboard/${funds[0].fund_id}`);
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
        Funds
      </h1>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {funds.map((f) => (
          <a
            key={f.fund_id}
            href={`/dashboard/${f.fund_id}`}
            className="group rounded-2xl border border-gray-200/60 bg-white p-6 transition-shadow hover:shadow-md"
          >
            <h2 className="text-base font-semibold text-gray-900 group-hover:text-violet-600">
              {f.fund_name}
            </h2>
            <p className="mt-1 text-xs text-gray-400">{f.fund_id}</p>
            <div className="mt-4 flex items-center gap-3">
              {f.is_verified && (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                  Verified
                </span>
              )}
              <span className="rounded-full bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-500">
                Threshold: {f.intent_threshold_weight}
              </span>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
