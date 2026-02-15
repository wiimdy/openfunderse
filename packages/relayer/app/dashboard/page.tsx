import { redirect } from "next/navigation";

import { listPublicFunds } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function DashboardIndex() {
  const funds = await listPublicFunds({ limit: 50, offset: 0 });
  if (funds.length === 1) {
    redirect(`/dashboard/${encodeURIComponent(funds[0].fund_id)}`);
  }

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

  return (
    <div>
      <div className="flex items-baseline gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Dashboard</h1>
        <span className="text-sm text-gray-400">{funds.length} funds</span>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {funds.map((fund) => (
          <a
            key={fund.fund_id}
            href={`/dashboard/${encodeURIComponent(fund.fund_id)}`}
            className="rounded-2xl border border-gray-200/60 bg-white p-6 transition-shadow hover:shadow-sm"
          >
            <p className="text-sm font-medium text-gray-900">{fund.fund_name}</p>
            <p className="mt-2 font-mono text-xs text-gray-400">{fund.fund_id}</p>
            <div className="mt-4 flex items-center gap-2 text-xs text-gray-500">
              <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                VERIFIED
              </span>
              <span className="inline-flex items-center rounded-full bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                {String(fund.visibility)}
              </span>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

