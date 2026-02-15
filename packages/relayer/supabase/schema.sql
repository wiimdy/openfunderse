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
  is_verified boolean not null default false,
  visibility text not null default 'HIDDEN',
  verification_note text,
  created_by text not null,
  created_at bigint not null,
  updated_at bigint not null
);

alter table if exists funds add column if not exists is_verified boolean not null default false;
alter table if exists funds add column if not exists visibility text not null default 'HIDDEN';
alter table if exists funds add column if not exists verification_note text;

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

-- DEPRECATED: bot_credentials table removed. Bot auth is now signature-based
-- (EIP-191) using bot_address in fund_bots table. Kept commented for reference.
-- create table if not exists bot_credentials (
--   id bigserial primary key,
--   bot_id text not null unique,
--   api_key text not null,
--   scopes text not null default '',
--   created_by text not null,
--   created_at bigint not null,
--   updated_at bigint not null
-- );

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

create table if not exists allocation_claims (
  id bigserial primary key,
  fund_id text not null,
  claim_hash text not null,
  epoch_id text not null,
  participant text not null,
  claim_json text not null,
  created_by text not null,
  created_at bigint not null,
  updated_at bigint not null,
  unique (fund_id, claim_hash)
);

create table if not exists stake_weights (
  id bigserial primary key,
  fund_id text not null,
  participant text not null,
  weight text not null,
  epoch_id text,
  created_at bigint not null,
  updated_at bigint not null,
  unique (fund_id, participant, epoch_id)
);

create table if not exists epoch_states (
  id bigserial primary key,
  fund_id text not null,
  epoch_id text not null,
  epoch_state_hash text not null,
  aggregate_weights_json text not null,
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

-- Atomic increment for subject_state.attested_weight (prevents RMW race condition)
create or replace function increment_attested_weight(
  p_subject_type text,
  p_subject_hash text,
  p_delta text
) returns text as $$
declare
  result text;
begin
  update subject_state
    set attested_weight = (cast(attested_weight as numeric) + cast(p_delta as numeric))::text,
        updated_at = (extract(epoch from now()) * 1000)::bigint
    where subject_type = p_subject_type
      and subject_hash = p_subject_hash
    returning attested_weight into result;
  return coalesce(result, p_delta);
end;
$$ language plpgsql;

-- Atomic 4-table state transition for subject approval.
-- CLAIM path: subject_state + attestations + claims → return (no execution_jobs).
-- INTENT path: subject_state + attestations + intents + execution_jobs upsert.
-- Reads existing tx_hash from subject_state when p_tx_hash is null.
create or replace function mark_subject_approved(
  p_subject_type text,
  p_subject_hash text,
  p_fund_id text,
  p_tx_hash text default null
) returns void as $$
declare
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
  v_effective_tx_hash text := p_tx_hash;
begin
  if v_effective_tx_hash is null then
    select tx_hash into v_effective_tx_hash
      from subject_state
      where fund_id = p_fund_id
        and subject_type = p_subject_type
        and subject_hash = p_subject_hash;
  end if;

  update subject_state
    set status = 'APPROVED',
        tx_hash = v_effective_tx_hash,
        updated_at = v_now
    where fund_id = p_fund_id
      and subject_type = p_subject_type
      and subject_hash = p_subject_hash;

  update attestations
    set status = 'APPROVED',
        tx_hash = v_effective_tx_hash,
        updated_at = v_now
    where fund_id = p_fund_id
      and subject_type = p_subject_type
      and subject_hash = p_subject_hash
      and status in ('PENDING', 'READY_FOR_ONCHAIN');

  if p_subject_type = 'CLAIM' then
    update claims
      set status = 'APPROVED', updated_at = v_now
      where fund_id = p_fund_id and claim_hash = p_subject_hash;
    return;
  end if;

  update intents
    set status = 'APPROVED', updated_at = v_now
    where fund_id = p_fund_id and intent_hash = p_subject_hash;

  insert into execution_jobs (fund_id, intent_hash, status, attempt_count, next_run_at, created_at, updated_at)
    values (p_fund_id, p_subject_hash, 'READY', 0, v_now, v_now, v_now)
    on conflict (fund_id, intent_hash)
    do update set status = 'READY', next_run_at = v_now, updated_at = v_now;
end;
$$ language plpgsql;

create index if not exists idx_attestations_subject on attestations(subject_type, subject_hash, status);
create index if not exists idx_fund_bots_fund on fund_bots(fund_id, status);
create index if not exists idx_fund_deployments_chain on fund_deployments(chain_id, onchain_fund_id);
create unique index if not exists idx_fund_deployments_tx_hash_unique on fund_deployments(deploy_tx_hash);
create index if not exists idx_allocation_claims_fund_epoch on allocation_claims(fund_id, epoch_id, created_at desc);
create index if not exists idx_epoch_states_fund_finalized on epoch_states(fund_id, finalized_at desc);
create index if not exists idx_intents_fund_snapshot on intents(fund_id, snapshot_hash, created_at desc);
create index if not exists idx_execution_jobs_status_next on execution_jobs(status, next_run_at, created_at);
create index if not exists idx_funds_verified_visibility on funds(is_verified, visibility, updated_at desc);
