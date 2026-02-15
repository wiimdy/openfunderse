import type { FundDeploymentRow } from "@/lib/supabase";

const shortHex = (value: string, left = 6, right = 4): string => {
  const v = String(value);
  if (!v.startsWith("0x")) return v;
  if (v.length <= left + right + 2) return v;
  return `${v.slice(0, left + 2)}…${v.slice(-right)}`;
};

export function DeploymentCard(props: { deployment?: FundDeploymentRow }) {
  const d = props.deployment;
  if (!d) {
    return (
      <div className="rounded-2xl border border-gray-200/60 bg-white p-6">
        <h3 className="text-sm font-medium text-gray-500">On-chain Deployment</h3>
        <p className="mt-3 text-sm text-gray-400">No deployment found.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-200/60 bg-white p-6">
      <h3 className="text-sm font-medium text-gray-500">On-chain Deployment</h3>
      <dl className="mt-4 space-y-2.5">
        <div className="flex items-center justify-between">
          <dt className="text-xs text-gray-400">Chain</dt>
          <dd className="font-mono text-xs text-gray-600">Monad (10143)</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-xs text-gray-400">Vault</dt>
          <dd className="font-mono text-xs text-gray-600">{shortHex(d.claw_vault_address)}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-xs text-gray-400">Core</dt>
          <dd className="font-mono text-xs text-gray-600">{shortHex(d.claw_core_address)}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-xs text-gray-400">IntentBook</dt>
          <dd className="font-mono text-xs text-gray-600">{shortHex(d.intent_book_address)}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-xs text-gray-400">SnapshotBook</dt>
          <dd className="font-mono text-xs text-gray-600">{shortHex(d.snapshot_book_address)}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-xs text-gray-400">Asset</dt>
          <dd className="font-mono text-xs text-gray-600">{shortHex(d.asset_address)}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-xs text-gray-400">Owner</dt>
          <dd className="font-mono text-xs text-gray-600">{shortHex(d.fund_owner_address)}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-xs text-gray-400">Strategy</dt>
          <dd className="font-mono text-xs text-gray-600">{shortHex(d.strategy_agent_address)}</dd>
        </div>
      </dl>

      <div className="mt-4 border-t border-gray-100 pt-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Deploy Tx</span>
          <span className="font-mono text-xs text-violet-600">{shortHex(d.deploy_tx_hash)}</span>
        </div>
      </div>
    </div>
  );
}

