create table if not exists funds (
  id bigserial primary key,
  fund_id text not null unique,
  fund_name text not null,
  strategy_bot_id text not null default '',
  strategy_bot_address text not null default '',
  verifier_threshold_weight text not null,
  intent_threshold_weight text not null,
  strategy_policy_uri text,
  telegram_room_id text,
  created_by text not null,
  created_at bigint not null,
  updated_at bigint not null
);

create table if not exists fund_bots (
  id bigserial primary key,
  fund_id text not null,
  bot_id text not null,
  role text not null,
  bot_address text not null,
  status text not null default 'ACTIVE',
  policy_uri text,
  telegram_handle text,
  registered_by text not null,
  created_at bigint not null,
  updated_at bigint not null,
  unique (fund_id, bot_id)
);

create table if not exists fund_deployments (
  id bigserial primary key,
  fund_id text not null unique,
  chain_id text not null,
  factory_address text not null,
  onchain_fund_id text not null,
  intent_book_address text not null,
  claw_core_address text not null,
  claw_vault_address text not null,
  fund_owner_address text not null,
  strategy_agent_address text not null,
  snapshot_book_address text not null,
  asset_address text not null,
  deploy_tx_hash text not null,
  deploy_block_number text not null,
  deployer_address text not null,
  created_at bigint not null,
  updated_at bigint not null
);

create table if not exists attestations (
  id bigserial primary key,
  fund_id text not null,
  subject_type text not null,
  subject_hash text not null,
  epoch_id text,
  verifier text not null,
  expires_at text not null,
  nonce text not null,
  signature text not null,
  status text not null default 'PENDING',
  tx_hash text,
  error text,
  created_at bigint not null,
  updated_at bigint not null,
  unique (subject_type, subject_hash, verifier)
);

create table if not exists subject_state (
  id bigserial primary key,
  fund_id text not null,
  subject_type text not null,
  subject_hash text not null,
  epoch_id text,
  threshold_weight text not null default '0',
  attested_weight text not null default '0',
  status text not null default 'PENDING',
  tx_hash text,
  submit_attempts integer not null default 0,
  last_error text,
  created_at bigint not null,
  updated_at bigint not null,
  unique (subject_type, subject_hash)
);

create table if not exists claims (
  id bigserial primary key,
  fund_id text not null,
  claim_hash text not null,
  epoch_id text not null,
  payload_json text not null,
  status text not null default 'PENDING',
  created_by text not null,
  created_at bigint not null,
  updated_at bigint not null,
  unique (fund_id, claim_hash)
);

create table if not exists snapshots (
  id bigserial primary key,
  fund_id text not null,
  epoch_id text not null,
  snapshot_hash text not null,
  claim_hashes_json text not null,
  claim_count integer not null,
  finalized_at bigint not null,
  created_at bigint not null,
  updated_at bigint not null,
  unique (fund_id, epoch_id)
);

create table if not exists intents (
  id bigserial primary key,
  fund_id text not null,
  intent_hash text not null,
  snapshot_hash text not null,
  intent_uri text,
  intent_json text not null,
  execution_route_json text not null default '{}',
  allowlist_hash text not null,
  max_slippage_bps text not null,
  max_notional text not null,
  deadline text not null,
  status text not null default 'PENDING',
  created_by text not null,
  created_at bigint not null,
  updated_at bigint not null,
  unique (fund_id, intent_hash)
);

create table if not exists execution_jobs (
  id bigserial primary key,
  fund_id text not null,
  intent_hash text not null,
  status text not null default 'READY',
  attempt_count integer not null default 0,
  next_run_at bigint not null,
  tx_hash text,
  last_error text,
  created_at bigint not null,
  updated_at bigint not null,
  unique (fund_id, intent_hash)
);

create index if not exists idx_attestations_subject on attestations(subject_type, subject_hash, status);
create index if not exists idx_fund_bots_fund on fund_bots(fund_id, status);
create index if not exists idx_fund_deployments_chain on fund_deployments(chain_id, onchain_fund_id);
create index if not exists idx_claims_fund_epoch on claims(fund_id, epoch_id, created_at desc);
create index if not exists idx_snapshots_fund_finalized on snapshots(fund_id, finalized_at desc);
create index if not exists idx_intents_fund_snapshot on intents(fund_id, snapshot_hash, created_at desc);
create index if not exists idx_execution_jobs_status_next on execution_jobs(status, next_run_at, created_at);
