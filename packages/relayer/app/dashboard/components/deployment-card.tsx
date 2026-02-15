function truncAddr(addr: string): string {
  if (!addr || addr.length <= 12) return addr || '—';
  return `${addr.slice(0, 8)}\u2026${addr.slice(-4)}`;
}

interface DeploymentInfo {
  chain_id: string;
  claw_vault_address: string;
  claw_core_address: string;
  intent_book_address: string;
  snapshot_book_address: string;
  asset_address: string;
  fund_owner_address: string;
  strategy_agent_address: string;
  deploy_tx_hash: string;
}

interface DeploymentCardProps {
  deployment: DeploymentInfo | null;
}

export function DeploymentCard({ deployment }: DeploymentCardProps) {
  if (!deployment) {
    return (
      <div className="rounded-2xl border border-gray-200/60 bg-white p-6">
        <h3 className="text-sm font-medium text-gray-500">
          On-chain Deployment
        </h3>
        <p className="mt-6 text-center text-sm text-gray-300">Not deployed</p>
      </div>
    );
  }

  const rows: Array<{ label: string; value: string }> = [
    { label: 'Chain', value: `Monad (${deployment.chain_id})` },
    { label: 'Vault', value: truncAddr(deployment.claw_vault_address) },
    { label: 'Core', value: truncAddr(deployment.claw_core_address) },
    { label: 'IntentBook', value: truncAddr(deployment.intent_book_address) },
    { label: 'SnapshotBook', value: truncAddr(deployment.snapshot_book_address) },
    { label: 'Asset', value: truncAddr(deployment.asset_address) },
    { label: 'Owner', value: truncAddr(deployment.fund_owner_address) },
    { label: 'Strategy', value: truncAddr(deployment.strategy_agent_address) },
  ];

  return (
    <div className="rounded-2xl border border-gray-200/60 bg-white p-6">
      <h3 className="text-sm font-medium text-gray-500">
        On-chain Deployment
      </h3>
      <dl className="mt-4 space-y-2.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between">
            <dt className="text-xs text-gray-400">{r.label}</dt>
            <dd className="font-mono text-xs text-gray-600">{r.value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 border-t border-gray-100 pt-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Deploy Tx</span>
          <span className="font-mono text-xs text-violet-600">
            {truncAddr(deployment.deploy_tx_hash)}
          </span>
        </div>
      </div>
    </div>
  );
}
