import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type SubjectType = "CLAIM" | "INTENT";
export type RecordStatus =
  | "PENDING"
  | "READY_FOR_ONCHAIN"
  | "APPROVED"
  | "REJECTED";

export interface AttestationRow {
  id: number;
  fund_id: string;
  subject_type: SubjectType;
  subject_hash: string;
  epoch_id: string | null;
  verifier: string;
  expires_at: string;
  nonce: string;
  signature: string;
  status: RecordStatus;
  tx_hash: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

export interface ClaimRow {
  id: number;
  fund_id: string;
  claim_hash: string;
  epoch_id: string;
  payload_json: string;
  status: RecordStatus;
  created_by: string;
  created_at: number;
  updated_at: number;
}

export interface SnapshotRow {
  id: number;
  fund_id: string;
  epoch_id: string;
  snapshot_hash: string;
  claim_hashes_json: string;
  claim_count: number;
  finalized_at: number;
  created_at: number;
  updated_at: number;
}

export interface AllocationClaimRow {
  id: number;
  fund_id: string;
  claim_hash: string;
  epoch_id: string;
  participant: string;
  claim_json: string;
  created_by: string;
  created_at: number;
  updated_at: number;
}

export interface EpochStateRow {
  id: number;
  fund_id: string;
  epoch_id: string;
  epoch_state_hash: string;
  aggregate_weights_json: string;
  claim_hashes_json: string;
  claim_count: number;
  finalized_at: number;
  created_at: number;
  updated_at: number;
}

export type EpochLifecycleStatus = "OPEN" | "CLOSED" | "AGGREGATED";

export interface EpochLifecycleRow {
  id: number;
  fund_id: string;
  epoch_id: string;
  status: EpochLifecycleStatus;
  opened_at: number;
  closes_at: number;
  closed_at: number | null;
  claim_count: number;
  created_at: number;
  updated_at: number;
}

export interface EventsOutboxRow {
  id: number;
  event_type: string;
  fund_id: string;
  payload: Record<string, unknown>;
  created_at: number;
}

export interface StakeWeightRow {
  id: number;
  fund_id: string;
  participant: string;
  weight: string;
  epoch_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface IntentRow {
  id: number;
  fund_id: string;
  intent_hash: string;
  snapshot_hash: string;
  intent_uri: string | null;
  intent_json: string;
  execution_route_json: string;
  allowlist_hash: string;
  max_slippage_bps: string;
  max_notional: string;
  deadline: string;
  status: RecordStatus;
  created_by: string;
  created_at: number;
  updated_at: number;
}

export interface FundRow {
  fund_id: string;
  fund_name: string;
  strategy_bot_id: string;
  strategy_bot_address: string;
  verifier_threshold_weight: string;
  intent_threshold_weight: string;
  strategy_policy_uri: string | null;
  telegram_room_id: string | null;
  is_verified: boolean;
  visibility: string;
  verification_note: string | null;
  allowlist_tokens_json?: string | null;
  created_by: string;
  created_at: number;
  updated_at: number;
}

export interface FundDeploymentRow {
  id: number;
  fund_id: string;
  chain_id: string;
  factory_address: string;
  onchain_fund_id: string;
  intent_book_address: string;
  claw_core_address: string;
  claw_vault_address: string;
  fund_owner_address: string;
  strategy_agent_address: string;
  snapshot_book_address: string;
  asset_address: string;
  deploy_tx_hash: string;
  deploy_block_number: string;
  deployer_address: string;
  created_at: number;
  updated_at: number;
}

export type ExecutionJobStatus =
  | "READY"
  | "READY_FOR_ONCHAIN"
  | "RUNNING"
  | "EXECUTED"
  | "FAILED_RETRYABLE"
  | "FAILED_FINAL";

export interface ExecutionJobRow {
  id: number;
  fund_id: string;
  intent_hash: string;
  status: ExecutionJobStatus;
  attempt_count: number;
  next_run_at: number;
  tx_hash: string | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

export interface SubjectStateRow {
  threshold_weight: string;
  attested_weight: string;
  status: RecordStatus;
  submit_attempts: number;
  tx_hash: string | null;
}

let supabaseSingleton: SupabaseClient | null = null;

function envRequired(key: string): string {
  const value = process.env[key];
  if (value && value.length > 0) return value;
  throw new Error(`missing required env: ${key}`);
}

function supabase(): SupabaseClient {
  if (supabaseSingleton) return supabaseSingleton;

  const url = envRequired("SUPABASE_URL");
  const key = envRequired("SUPABASE_ANON_KEY");

  supabaseSingleton = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
  return supabaseSingleton;
}

function nowMs(): number {
  return Date.now();
}

function isDuplicateError(error: unknown): boolean {
  const msg = String((error as { message?: string } | null)?.message ?? error ?? "").toLowerCase();
  return msg.includes("duplicate") || msg.includes("23505") || msg.includes("unique");
}

function throwIfError<T>(error: { message?: string; code?: string } | null, data: T): T {
  if (error) {
    if (error.code === "PGRST205") {
      throw new Error(
        `PGRST205: missing tables. Apply packages/relayer/supabase/schema.sql in Supabase SQL Editor.`
      );
    }
    throw new Error(`${error.code ?? "supabase_error"}: ${error.message ?? "unknown error"}`);
  }
  return data;
}

export async function upsertFund(input: {
  fundId: string;
  fundName: string;
  strategyBotId: string;
  strategyBotAddress: string;
  verifierThresholdWeight: bigint;
  intentThresholdWeight: bigint;
  strategyPolicyUri: string | null;
  telegramRoomId: string | null;
  isVerified?: boolean;
  visibility?: "PUBLIC" | "HIDDEN";
  verificationNote?: string | null;
  allowlistTokens?: string[];
  autoEpochEnabled?: boolean;
  epochDurationMs?: number;
  epochMinClaims?: number;
  epochMaxClaims?: number;
  createdBy: string;
}) {
  const db = supabase();
  const now = nowMs();
  const payload: Record<string, unknown> = {
    fund_id: input.fundId,
    fund_name: input.fundName,
    strategy_bot_id: input.strategyBotId,
    strategy_bot_address: input.strategyBotAddress,
    verifier_threshold_weight: input.verifierThresholdWeight.toString(),
    intent_threshold_weight: input.intentThresholdWeight.toString(),
    strategy_policy_uri: input.strategyPolicyUri,
    telegram_room_id: input.telegramRoomId,
    created_by: input.createdBy,
    created_at: now,
    updated_at: now
  };
  if (input.isVerified !== undefined) {
    payload.is_verified = input.isVerified;
  }
  if (input.visibility !== undefined) {
    payload.visibility = input.visibility;
  }
  if (input.verificationNote !== undefined) {
    payload.verification_note = input.verificationNote;
  }
  if (input.allowlistTokens !== undefined) {
    payload.allowlist_tokens_json = JSON.stringify(
      input.allowlistTokens.map((t) => t.trim().toLowerCase())
    );
  }
  if (input.autoEpochEnabled !== undefined) {
    payload.auto_epoch_enabled = input.autoEpochEnabled;
  }
  if (input.epochDurationMs !== undefined) {
    payload.epoch_duration_ms = input.epochDurationMs;
  }
  if (input.epochMinClaims !== undefined) {
    payload.epoch_min_claims = input.epochMinClaims;
  }
  if (input.epochMaxClaims !== undefined) {
    payload.epoch_max_claims = input.epochMaxClaims;
  }

  const { error } = await db.from("funds").upsert(
    payload,
    {
      onConflict: "fund_id"
    }
  );
  throwIfError(error, null);
}

export async function getFund(fundId: string) {
  const db = supabase();
  const { data, error } = await db
    .from("funds")
    .select(
      "fund_id,fund_name,strategy_bot_id,strategy_bot_address,verifier_threshold_weight,intent_threshold_weight,strategy_policy_uri,telegram_room_id,is_verified,visibility,verification_note,created_by,created_at,updated_at,allowlist_tokens_json"
    )
    .eq("fund_id", fundId)
    .maybeSingle();
  throwIfError(error, null);
  return (data as FundRow | null) ?? undefined;
}

export async function getFundByTelegramRoomId(roomId: string) {
  const db = supabase();
  const { data, error } = await db
    .from("funds")
    .select(
      "fund_id,fund_name,strategy_bot_id,strategy_bot_address,verifier_threshold_weight,intent_threshold_weight,strategy_policy_uri,telegram_room_id,is_verified,visibility,verification_note,created_by,created_at,updated_at,allowlist_tokens_json"
    )
    .eq("telegram_room_id", roomId)
    .maybeSingle();
  throwIfError(error, null);
  return (data as FundRow | null) ?? undefined;
}

export async function listPublicFunds(input?: {
  limit?: number;
  offset?: number;
}): Promise<FundRow[]> {
  const db = supabase();
  const limit = input?.limit ?? 50;
  const offset = input?.offset ?? 0;
  const { data, error } = await db
    .from("funds")
    .select(
      "fund_id,fund_name,strategy_bot_id,strategy_bot_address,verifier_threshold_weight,intent_threshold_weight,strategy_policy_uri,telegram_room_id,is_verified,visibility,verification_note,created_by,created_at,updated_at,allowlist_tokens_json"
    )
    .eq("is_verified", true)
    .eq("visibility", "PUBLIC")
    .order("updated_at", { ascending: false })
    .range(offset, offset + Math.max(limit - 1, 0));
  throwIfError(error, null);
  return (data ?? []) as FundRow[];
}

export async function updateFundVerification(input: {
  fundId: string;
  isVerified: boolean;
  visibility: "PUBLIC" | "HIDDEN";
  verificationNote: string | null;
}): Promise<void> {
  const db = supabase();
  const { error } = await db
    .from("funds")
    .update({
      is_verified: input.isVerified,
      visibility: input.visibility,
      verification_note: input.verificationNote,
      updated_at: nowMs()
    })
    .eq("fund_id", input.fundId);
  throwIfError(error, null);
}

export async function getFundThresholds(
  fundId: string
): Promise<{ claimThresholdWeight: bigint; intentThresholdWeight: bigint } | null> {
  const fund = await getFund(fundId);
  if (!fund) return null;
  return {
    claimThresholdWeight: BigInt(fund.verifier_threshold_weight),
    intentThresholdWeight: BigInt(fund.intent_threshold_weight)
  };
}

export async function upsertFundDeployment(input: {
  fundId: string;
  chainId: bigint;
  factoryAddress: string;
  onchainFundId: bigint;
  intentBookAddress: string;
  clawCoreAddress: string;
  clawVaultAddress: string;
  fundOwnerAddress: string;
  strategyAgentAddress: string;
  snapshotBookAddress: string;
  assetAddress: string;
  deployTxHash: string;
  deployBlockNumber: bigint;
  deployerAddress: string;
}): Promise<void> {
  const db = supabase();
  const now = nowMs();
  const { error } = await db.from("fund_deployments").upsert(
    {
      fund_id: input.fundId,
      chain_id: input.chainId.toString(),
      factory_address: input.factoryAddress.toLowerCase(),
      onchain_fund_id: input.onchainFundId.toString(),
      intent_book_address: input.intentBookAddress.toLowerCase(),
      claw_core_address: input.clawCoreAddress.toLowerCase(),
      claw_vault_address: input.clawVaultAddress.toLowerCase(),
      fund_owner_address: input.fundOwnerAddress.toLowerCase(),
      strategy_agent_address: input.strategyAgentAddress.toLowerCase(),
      snapshot_book_address: input.snapshotBookAddress.toLowerCase(),
      asset_address: input.assetAddress.toLowerCase(),
      deploy_tx_hash: input.deployTxHash.toLowerCase(),
      deploy_block_number: input.deployBlockNumber.toString(),
      deployer_address: input.deployerAddress.toLowerCase(),
      created_at: now,
      updated_at: now
    },
    {
      onConflict: "fund_id"
    }
  );
  throwIfError(error, null);
}

export async function getFundDeployment(fundId: string): Promise<FundDeploymentRow | undefined> {
  const db = supabase();
  const { data, error } = await db
    .from("fund_deployments")
    .select(
      "id,fund_id,chain_id,factory_address,onchain_fund_id,intent_book_address,claw_core_address,claw_vault_address,fund_owner_address,strategy_agent_address,snapshot_book_address,asset_address,deploy_tx_hash,deploy_block_number,deployer_address,created_at,updated_at"
    )
    .eq("fund_id", fundId)
    .maybeSingle();
  throwIfError(error, null);
  return (data as FundDeploymentRow | null) ?? undefined;
}

export async function getFundDeploymentByTxHash(
  txHash: string
): Promise<FundDeploymentRow | undefined> {
  const db = supabase();
  const { data, error } = await db
    .from("fund_deployments")
    .select(
      "id,fund_id,chain_id,factory_address,onchain_fund_id,intent_book_address,claw_core_address,claw_vault_address,fund_owner_address,strategy_agent_address,snapshot_book_address,asset_address,deploy_tx_hash,deploy_block_number,deployer_address,created_at,updated_at"
    )
    .eq("deploy_tx_hash", txHash.toLowerCase())
    .maybeSingle();
  throwIfError(error, null);
  return (data as FundDeploymentRow | null) ?? undefined;
}

export async function upsertFundBot(input: {
  fundId: string;
  botId: string;
  role: string;
  botAddress: string;
  status: "ACTIVE" | "DISABLED";
  policyUri: string | null;
  telegramHandle: string | null;
  registeredBy: string;
}) {
  const db = supabase();
  const now = nowMs();
  const { error } = await db.from("fund_bots").upsert(
    {
      fund_id: input.fundId,
      bot_id: input.botId,
      role: input.role,
      bot_address: input.botAddress,
      status: input.status,
      policy_uri: input.policyUri,
      telegram_handle: input.telegramHandle,
      registered_by: input.registeredBy,
      created_at: now,
      updated_at: now
    },
    {
      onConflict: "fund_id,bot_id"
    }
  );
  throwIfError(error, null);
}

export async function listFundBots(fundId: string) {
  const db = supabase();
  const { data, error } = await db
    .from("fund_bots")
    .select(
      "fund_id,bot_id,role,bot_address,status,policy_uri,telegram_handle,registered_by,created_at,updated_at"
    )
    .eq("fund_id", fundId)
    .order("created_at", { ascending: true });
  throwIfError(error, null);
  return (data ?? []) as Array<{
    fund_id: string;
    bot_id: string;
    role: string;
    bot_address: string;
    status: string;
    policy_uri: string | null;
    telegram_handle: string | null;
    registered_by: string;
    created_at: number;
    updated_at: number;
  }>;
}

export async function listActiveFundParticipants(
  fundId: string
): Promise<Array<{ bot_address: string; bot_id: string }>> {
  const db = supabase();
  const { data, error } = await db
    .from("fund_bots")
    .select("bot_address,bot_id")
    .eq("fund_id", fundId)
    .eq("role", "participant")
    .eq("status", "ACTIVE");
  throwIfError(error, null);
  return (data ?? []) as Array<{ bot_address: string; bot_id: string }>;
}

export async function getBotsByBotId(botId: string) {
  const db = supabase();
  const { data, error } = await db
    .from("fund_bots")
    .select(
      "fund_id,bot_id,role,bot_address,status,policy_uri,telegram_handle,registered_by,created_at,updated_at"
    )
    .eq("bot_id", botId)
    .order("created_at", { ascending: true });
  throwIfError(error, null);
  return (data ?? []) as Array<{
    fund_id: string;
    bot_id: string;
    role: string;
    bot_address: string;
    status: string;
    policy_uri: string | null;
    telegram_handle: string | null;
    registered_by: string;
    created_at: number;
    updated_at: number;
  }>;
}

export async function insertBotAuthNonce(
  botId: string,
  nonce: string
): Promise<{ ok: true } | { ok: false; reason: "DUPLICATE" }> {
  const db = supabase();
  const { error } = await db.from("bot_auth_nonces").insert({
    bot_id: botId,
    nonce
  });

  if (error) {
    if (isDuplicateError(error)) return { ok: false, reason: "DUPLICATE" };
    throwIfError(error, null);
  }

  return { ok: true };
}

export async function getFundBot(fundId: string, botId: string) {
  const db = supabase();
  const { data, error } = await db
    .from('fund_bots')
    .select(
      'fund_id,bot_id,role,bot_address,status,policy_uri,telegram_handle,registered_by,created_at,updated_at'
    )
    .eq('fund_id', fundId)
    .eq('bot_id', botId)
    .maybeSingle();
  throwIfError(error, null);
  return (data as
    | {
        fund_id: string;
        bot_id: string;
        role: string;
        bot_address: string;
        status: string;
        policy_uri: string | null;
        telegram_handle: string | null;
        registered_by: string;
        created_at: number;
        updated_at: number;
      }
    | null) ?? undefined;
}

export async function insertAttestation(input: {
  fundId: string;
  subjectType: SubjectType;
  subjectHash: string;
  epochId: bigint | null;
  verifier: string;
  expiresAt: bigint;
  nonce: bigint;
  signature: string;
  status?: RecordStatus;
  txHash?: string | null;
}): Promise<{ ok: true; id: number } | { ok: false; reason: "DUPLICATE" }> {
  const db = supabase();
  const now = nowMs();
  const status = input.status ?? "PENDING";
  const txHash = input.txHash ? input.txHash.toLowerCase() : null;
  const { data, error } = await db
    .from("attestations")
    .insert({
      fund_id: input.fundId,
      subject_type: input.subjectType,
      subject_hash: input.subjectHash.toLowerCase(),
      epoch_id: input.epochId === null ? null : input.epochId.toString(),
      verifier: input.verifier.toLowerCase(),
      expires_at: input.expiresAt.toString(),
      nonce: input.nonce.toString(),
      signature: input.signature,
      status,
      tx_hash: txHash,
      created_at: now,
      updated_at: now
    })
    .select("id")
    .single();

  if (error) {
    if (isDuplicateError(error)) return { ok: false, reason: "DUPLICATE" };
    throwIfError(error, null);
  }

  return { ok: true, id: Number(data!.id) };
}

export async function upsertSubjectState(input: {
  fundId: string;
  subjectType: SubjectType;
  subjectHash: string;
  epochId: bigint | null;
  thresholdWeight: bigint;
}): Promise<void> {
  const db = supabase();
  const now = nowMs();
  const key = input.subjectHash.toLowerCase();
  const { data: existing, error: existingError } = await db
    .from("subject_state")
    .select("id")
    .eq("fund_id", input.fundId)
    .eq("subject_type", input.subjectType)
    .eq("subject_hash", key)
    .maybeSingle();
  throwIfError(existingError, null);

  if (!existing) {
    const { error } = await db.from("subject_state").insert({
      fund_id: input.fundId,
      subject_type: input.subjectType,
      subject_hash: key,
      epoch_id: input.epochId === null ? null : input.epochId.toString(),
      threshold_weight: input.thresholdWeight.toString(),
      attested_weight: "0",
      status: "PENDING",
      created_at: now,
      updated_at: now
    });
    throwIfError(error, null);
    return;
  }

  const { error } = await db
    .from("subject_state")
    .update({ threshold_weight: input.thresholdWeight.toString(), updated_at: now })
    .eq("fund_id", input.fundId)
    .eq("subject_type", input.subjectType)
    .eq("subject_hash", key);
  throwIfError(error, null);
}

export async function incrementSubjectAttestedWeight(
  fundId: string,
  subjectType: SubjectType,
  subjectHash: string,
  delta: bigint
): Promise<bigint> {
  if (delta < BigInt(0)) throw new Error("delta must be non-negative");
  const db = supabase();
  const key = subjectHash.toLowerCase();
  const { data, error } = await db.rpc("increment_subject_attested_weight_atomic", {
    p_fund_id: fundId,
    p_subject_type: subjectType,
    p_subject_hash: key,
    p_delta: delta.toString()
  });
  throwIfError(error, null);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || row.attested_weight === undefined || row.attested_weight === null) {
    throw new Error("subject_state_not_found");
  }

  return BigInt(String(row.attested_weight));
}

export async function getSubjectState(subjectType: SubjectType, subjectHash: string) {
  const db = supabase();
  const { data, error } = await db
    .from("subject_state")
    .select("threshold_weight,attested_weight,status,submit_attempts,tx_hash")
    .eq("subject_type", subjectType)
    .eq("subject_hash", subjectHash.toLowerCase())
    .maybeSingle();
  throwIfError(error, null);
  return (data as SubjectStateRow | null) ?? undefined;
}

export async function getSubjectStateByFund(
  fundId: string,
  subjectType: SubjectType,
  subjectHash: string
) {
  const db = supabase();
  const { data, error } = await db
    .from("subject_state")
    .select("threshold_weight,attested_weight,status,submit_attempts,tx_hash")
    .eq("fund_id", fundId)
    .eq("subject_type", subjectType)
    .eq("subject_hash", subjectHash.toLowerCase())
    .maybeSingle();
  throwIfError(error, null);
  return (data as SubjectStateRow | null) ?? undefined;
}

export async function listPendingAttestations(
  subjectType: SubjectType,
  subjectHash: string,
  fundId?: string
): Promise<AttestationRow[]> {
  const db = supabase();
  let query = db
    .from("attestations")
    .select("*")
    .eq("subject_type", subjectType)
    .eq("subject_hash", subjectHash.toLowerCase())
    .eq("status", "PENDING");
  if (fundId) {
    query = query.eq("fund_id", fundId);
  }
  const { data, error } = await query.order("created_at", { ascending: true });
  throwIfError(error, null);
  return (data ?? []) as AttestationRow[];
}

export async function markSubjectApproved(input: {
  fundId: string;
  subjectType: SubjectType;
  subjectHash: string;
  txHash?: string | null;
}): Promise<void> {
  const db = supabase();
  const key = input.subjectHash.toLowerCase();
  const txHash = input.txHash ? input.txHash.toLowerCase() : null;

  const { error } = await db.rpc("mark_subject_approved", {
    p_subject_type: input.subjectType,
    p_subject_hash: key,
    p_fund_id: input.fundId,
    p_tx_hash: txHash,
  });
  throwIfError(error, null);
}

export async function markIntentReadyForOnchain(input: {
  fundId: string;
  intentHash: string;
}): Promise<void> {
  const db = supabase();
  const now = nowMs();
  const key = input.intentHash.toLowerCase();

  const { error: stateError } = await db
    .from("subject_state")
    .update({ status: "READY_FOR_ONCHAIN", updated_at: now })
    .eq("fund_id", input.fundId)
    .eq("subject_type", "INTENT")
    .eq("subject_hash", key)
    .eq("status", "PENDING");
  throwIfError(stateError, null);

  {
    const { error } = await db
      .from("attestations")
      .update({ status: "READY_FOR_ONCHAIN", updated_at: now })
      .eq("fund_id", input.fundId)
      .eq("subject_type", "INTENT")
      .eq("subject_hash", key)
      .eq("status", "PENDING");
    throwIfError(error, null);
  }

  {
    const { error } = await db
      .from("intents")
      .update({ status: "READY_FOR_ONCHAIN", updated_at: now })
      .eq("fund_id", input.fundId)
      .eq("intent_hash", key)
      .in("status", ["PENDING", "READY_FOR_ONCHAIN"]);
    throwIfError(error, null);
  }

  const { error } = await db.from("execution_jobs").upsert(
    {
      fund_id: input.fundId,
      intent_hash: key,
      status: "READY_FOR_ONCHAIN",
      attempt_count: 0,
      next_run_at: now,
      created_at: now,
      updated_at: now
    },
    {
      onConflict: "fund_id,intent_hash"
    }
  );
  throwIfError(error, null);
}

export async function markSubjectSubmitError(input: {
  subjectType: SubjectType;
  subjectHash: string;
  message: string;
}): Promise<void> {
  const db = supabase();
  const key = input.subjectHash.toLowerCase();
  const { data, error: findError } = await db
    .from("subject_state")
    .select("submit_attempts")
    .eq("subject_type", input.subjectType)
    .eq("subject_hash", key)
    .maybeSingle();
  throwIfError(findError, null);

  const submitAttempts = Number(data?.submit_attempts ?? 0) + 1;
  const { error } = await db
    .from("subject_state")
    .update({
      submit_attempts: submitAttempts,
      last_error: input.message,
      updated_at: nowMs()
    })
    .eq("subject_type", input.subjectType)
    .eq("subject_hash", key);
  throwIfError(error, null);
}

export async function getStatusSummary(fundId: string) {
  const db = supabase();
  const { data: intentStates, error } = await db
    .from("subject_state")
    .select("subject_type,status,threshold_weight,attested_weight")
    .eq("fund_id", fundId)
    .eq("subject_type", "INTENT");
  throwIfError(error, null);

  const { count: allocationClaimCount, error: allocationError } = await db
    .from("allocation_claims")
    .select("id", { count: "exact", head: true })
    .eq("fund_id", fundId);
  throwIfError(allocationError, null);

  const { data: latestEpochRow, error: epochError } = await db
    .from("epoch_states")
    .select("epoch_id,epoch_state_hash,claim_count,finalized_at")
    .eq("fund_id", fundId)
    .order("finalized_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  throwIfError(epochError, null);

  let intentsPending = 0;
  let intentsApproved = 0;
  let intentAttestedWeight = BigInt(0);
  let intentThresholdWeight = BigInt(0);

  for (const row of (intentStates ?? []) as Array<{
    subject_type: SubjectType;
    status: RecordStatus;
    threshold_weight: string;
    attested_weight: string;
  }>) {
    if (row.status === "PENDING" || row.status === "READY_FOR_ONCHAIN") intentsPending += 1;
    if (row.status === "APPROVED") intentsApproved += 1;
    intentAttestedWeight += BigInt(row.attested_weight);
    intentThresholdWeight += BigInt(row.threshold_weight);
  }

  return {
    allocations: {
      claimCount: Number(allocationClaimCount ?? 0),
      latestEpoch: latestEpochRow
        ? {
            epochId: String(latestEpochRow.epoch_id),
            epochStateHash: String(latestEpochRow.epoch_state_hash),
            claimCount: Number(latestEpochRow.claim_count),
            finalizedAt: Number(latestEpochRow.finalized_at)
          }
        : null
    },
    intents: {
      pending: intentsPending,
      approved: intentsApproved,
      attestedWeight: intentAttestedWeight.toString(),
      thresholdWeight: intentThresholdWeight.toString()
    }
  };
}

export async function insertClaim(input: {
  fundId: string;
  claimHash: string;
  epochId: bigint;
  payloadJson: string;
  createdBy: string;
}): Promise<{ ok: true; id: number } | { ok: false; reason: "DUPLICATE" }> {
  const db = supabase();
  const now = nowMs();
  const { data, error } = await db
    .from("claims")
    .insert({
      fund_id: input.fundId,
      claim_hash: input.claimHash.toLowerCase(),
      epoch_id: input.epochId.toString(),
      payload_json: input.payloadJson,
      status: "PENDING",
      created_by: input.createdBy,
      created_at: now,
      updated_at: now
    })
    .select("id")
    .single();

  if (error) {
    if (isDuplicateError(error)) return { ok: false, reason: "DUPLICATE" };
    throwIfError(error, null);
  }

  return { ok: true, id: Number(data!.id) };
}

export async function listClaimsByFund(input: {
  fundId: string;
  status?: RecordStatus;
  epochId?: bigint;
  limit: number;
  offset: number;
}) {
  const db = supabase();

  const { data: claims, error: claimsError } = await db
    .from("claims")
    .select("id,fund_id,claim_hash,epoch_id,payload_json,status,created_by,created_at,updated_at")
    .eq("fund_id", input.fundId)
    .order("created_at", { ascending: false });
  throwIfError(claimsError, null);

  const { data: states, error: statesError } = await db
    .from("subject_state")
    .select("subject_hash,status,attested_weight,threshold_weight")
    .eq("fund_id", input.fundId)
    .eq("subject_type", "CLAIM");
  throwIfError(statesError, null);

  const { data: att, error: attError } = await db
    .from("attestations")
    .select("subject_hash")
    .eq("subject_type", "CLAIM");
  throwIfError(attError, null);

  const stateMap = new Map(
    (states ?? []).map((row) => [String(row.subject_hash).toLowerCase(), row])
  );
  const attCount = new Map<string, number>();
  for (const row of att ?? []) {
    const key = String(row.subject_hash).toLowerCase();
    attCount.set(key, (attCount.get(key) ?? 0) + 1);
  }

  let rows = (claims ?? []).map((row) => {
    const key = String(row.claim_hash).toLowerCase();
    const state = stateMap.get(key);
    return {
      ...row,
      status: (state?.status ?? row.status) as RecordStatus,
      attested_weight: String(state?.attested_weight ?? "0"),
      threshold_weight: String(state?.threshold_weight ?? "0"),
      attestation_count: attCount.get(key) ?? 0
    };
  });

  if (input.epochId !== undefined) {
    const epoch = input.epochId.toString();
    rows = rows.filter((row) => String(row.epoch_id) === epoch);
  }
  if (input.status) {
    rows = rows.filter((row) => row.status === input.status);
  }

  const total = rows.length;
  const sliced = rows.slice(input.offset, input.offset + input.limit);

  return {
    rows: sliced as Array<{
      id: number;
      fund_id: string;
      claim_hash: string;
      epoch_id: string;
      payload_json: string;
      status: RecordStatus;
      attested_weight: string;
      threshold_weight: string;
      attestation_count: number;
      created_by: string;
      created_at: number;
      updated_at: number;
    }>,
    total
  };
}

export async function upsertSnapshot(input: {
  fundId: string;
  epochId: bigint;
  snapshotHash: string;
  claimHashes: string[];
}): Promise<void> {
  const db = supabase();
  const now = nowMs();
  const { error } = await db.from("snapshots").upsert(
    {
      fund_id: input.fundId,
      epoch_id: input.epochId.toString(),
      snapshot_hash: input.snapshotHash.toLowerCase(),
      claim_hashes_json: JSON.stringify(input.claimHashes.map((h) => h.toLowerCase())),
      claim_count: input.claimHashes.length,
      finalized_at: now,
      created_at: now,
      updated_at: now
    },
    {
      onConflict: "fund_id,epoch_id"
    }
  );
  throwIfError(error, null);
}

export async function getLatestSnapshot(fundId: string): Promise<SnapshotRow | undefined> {
  const db = supabase();
  const { data, error } = await db
    .from("snapshots")
    .select("*")
    .eq("fund_id", fundId)
    .order("finalized_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  throwIfError(error, null);
  return (data as SnapshotRow | null) ?? undefined;
}

export async function getApprovedClaimHashesByFund(
  fundId: string
): Promise<Array<{ claimHash: string; epochId: bigint }>> {
  const db = supabase();
  const { data: claims, error: claimsError } = await db
    .from("claims")
    .select("claim_hash,epoch_id,status")
    .eq("fund_id", fundId)
    .order("epoch_id", { ascending: true })
    .order("claim_hash", { ascending: true });
  throwIfError(claimsError, null);

  const { data: states, error: statesError } = await db
    .from("subject_state")
    .select("subject_hash,status")
    .eq("fund_id", fundId)
    .eq("subject_type", "CLAIM");
  throwIfError(statesError, null);

  const stateMap = new Map(
    (states ?? []).map((row) => [String(row.subject_hash).toLowerCase(), String(row.status)])
  );

  return (claims ?? [])
    .filter((row) => {
      const hash = String(row.claim_hash).toLowerCase();
      const status = stateMap.get(hash) ?? String(row.status);
      return status === "APPROVED";
    })
    .map((row) => ({
      claimHash: String(row.claim_hash),
      epochId: BigInt(String(row.epoch_id))
    }));
}

export async function insertIntent(input: {
  fundId: string;
  intentHash: string;
  snapshotHash: string;
  intentUri: string | null;
  intentJson: string;
  executionRouteJson: string;
  allowlistHash: string;
  maxSlippageBps: bigint;
  maxNotional: bigint;
  deadline: bigint;
  createdBy: string;
}): Promise<{ ok: true; id: number } | { ok: false; reason: "DUPLICATE" }> {
  const db = supabase();
  const now = nowMs();
  const { data, error } = await db
    .from("intents")
    .insert({
      fund_id: input.fundId,
      intent_hash: input.intentHash.toLowerCase(),
      snapshot_hash: input.snapshotHash.toLowerCase(),
      intent_uri: input.intentUri,
      intent_json: input.intentJson,
      execution_route_json: input.executionRouteJson,
      allowlist_hash: input.allowlistHash.toLowerCase(),
      max_slippage_bps: input.maxSlippageBps.toString(),
      max_notional: input.maxNotional.toString(),
      deadline: input.deadline.toString(),
      status: "PENDING",
      created_by: input.createdBy,
      created_at: now,
      updated_at: now
    })
    .select("id")
    .single();

  if (error) {
    if (isDuplicateError(error)) return { ok: false, reason: "DUPLICATE" };
    throwIfError(error, null);
  }

  return { ok: true, id: Number(data!.id) };
}

export async function getIntentByHash(
  fundId: string,
  intentHash: string
): Promise<IntentRow | undefined> {
  const db = supabase();
  const { data, error } = await db
    .from("intents")
    .select("*")
    .eq("fund_id", fundId)
    .eq("intent_hash", intentHash.toLowerCase())
    .maybeSingle();
  throwIfError(error, null);
  return (data as IntentRow | null) ?? undefined;
}

export async function getIntentAttestationBundle(input: {
  fundId: string;
  intentHash: string;
}): Promise<
  | {
      subjectHash: string;
      stateStatus: RecordStatus;
      thresholdWeight: string;
      attestedWeight: string;
      verifiers: string[];
      signatures: string[];
      attestations: Array<{
        verifier: string;
        expiresAt: string;
        nonce: string;
        signature: string;
      }>;
    }
  | undefined
> {
  const db = supabase();
  const key = input.intentHash.toLowerCase();

  const { data: state, error: stateError } = await db
    .from("subject_state")
    .select("status,threshold_weight,attested_weight")
    .eq("fund_id", input.fundId)
    .eq("subject_type", "INTENT")
    .eq("subject_hash", key)
    .maybeSingle();
  throwIfError(stateError, null);
  if (!state) return undefined;

  const { data: rows, error: rowsError } = await db
    .from("attestations")
    .select("verifier,expires_at,nonce,signature")
    .eq("fund_id", input.fundId)
    .eq("subject_type", "INTENT")
    .eq("subject_hash", key)
    .order("created_at", { ascending: true });
  throwIfError(rowsError, null);

  const attestations = (rows ?? []).map((row) => ({
    verifier: String(row.verifier),
    expiresAt: String(row.expires_at),
    nonce: String(row.nonce),
    signature: String(row.signature)
  }));
  const verifiers = attestations.map((row) => row.verifier);
  const signatures = attestations.map((row) => row.signature);

  return {
    subjectHash: key,
    stateStatus: state.status as RecordStatus,
    thresholdWeight: String(state.threshold_weight),
    attestedWeight: String(state.attested_weight),
    verifiers,
    signatures,
    attestations
  };
}

export async function listReadyOnchainExecutionJobs(input: {
  fundId: string;
  limit: number;
  offset: number;
}) {
  const db = supabase();

  const { data: jobs, error: jobsError, count } = await db
    .from("execution_jobs")
    .select("*", { count: "exact" })
    .eq("fund_id", input.fundId)
    .eq("status", "READY_FOR_ONCHAIN")
    .order("created_at", { ascending: true })
    .range(input.offset, input.offset + input.limit - 1);
  throwIfError(jobsError, null);

  const intentHashes = (jobs ?? []).map((job) => String(job.intent_hash).toLowerCase());
  if (intentHashes.length === 0) {
    return {
      rows: [] as Array<{
        job: ExecutionJobRow;
        intent: IntentRow;
      }>,
      total: Number(count ?? 0)
    };
  }

  const { data: intents, error: intentsError } = await db
    .from("intents")
    .select("*")
    .eq("fund_id", input.fundId)
    .in("intent_hash", intentHashes);
  throwIfError(intentsError, null);

  const intentMap = new Map(
    (intents ?? []).map((intent) => [String(intent.intent_hash).toLowerCase(), intent as IntentRow])
  );
  const rows = (jobs ?? [])
    .map((job) => {
      const intent = intentMap.get(String(job.intent_hash).toLowerCase());
      if (!intent) return null;
      return {
        job: job as ExecutionJobRow,
        intent
      };
    })
    .filter(Boolean) as Array<{
    job: ExecutionJobRow;
    intent: IntentRow;
  }>;

  return {
    rows,
    total: Number(count ?? 0)
  };
}

export async function listReadyExecutionPayloads(input: {
  fundId: string;
  limit: number;
  offset: number;
}) {
  const db = supabase();

  const { data: jobs, error: jobsError, count } = await db
    .from("execution_jobs")
    .select("*", { count: "exact" })
    .eq("fund_id", input.fundId)
    .in("status", ["READY", "READY_FOR_ONCHAIN"])
    .order("created_at", { ascending: true })
    .range(input.offset, input.offset + input.limit - 1);
  throwIfError(jobsError, null);

  const intentHashes = (jobs ?? []).map((job) => String(job.intent_hash).toLowerCase());
  if (intentHashes.length === 0) {
    return {
      rows: [] as Array<{
        job: ExecutionJobRow;
        intent: IntentRow;
      }>,
      total: Number(count ?? 0)
    };
  }

  const { data: intents, error: intentsError } = await db
    .from("intents")
    .select("*")
    .eq("fund_id", input.fundId)
    .in("intent_hash", intentHashes);
  throwIfError(intentsError, null);

  const intentMap = new Map(
    (intents ?? []).map((intent) => [String(intent.intent_hash).toLowerCase(), intent as IntentRow])
  );

  const rows = (jobs ?? [])
    .map((job) => {
      const intent = intentMap.get(String(job.intent_hash).toLowerCase());
      if (!intent) return null;
      return {
        job: job as ExecutionJobRow,
        intent
      };
    })
    .filter(Boolean) as Array<{
    job: ExecutionJobRow;
    intent: IntentRow;
  }>;

  return {
    rows,
    total: Number(count ?? 0)
  };
}

export async function listExecutionJobs(input: {
  fundId?: string;
  status?: ExecutionJobStatus;
  limit: number;
  offset: number;
}) {
  const db = supabase();

  let query = db.from("execution_jobs").select("*", { count: "exact" });
  if (input.fundId) query = query.eq("fund_id", input.fundId);
  if (input.status) query = query.eq("status", input.status);

  const from = input.offset;
  const to = input.offset + input.limit - 1;
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(from, to);
  throwIfError(error, null);

  return {
    rows: (data ?? []) as ExecutionJobRow[],
    total: Number(count ?? 0)
  };
}

export async function claimReadyExecutionJobs(limit: number): Promise<ExecutionJobRow[]> {
  const db = supabase();
  const now = nowMs();

  const { data, error } = await db
    .from("execution_jobs")
    .select("*")
    .in("status", ["READY", "READY_FOR_ONCHAIN", "FAILED_RETRYABLE"])
    .lte("next_run_at", now)
    .order("created_at", { ascending: true })
    .limit(limit);
  throwIfError(error, null);

  const rows = (data ?? []) as ExecutionJobRow[];
  for (const row of rows) {
    const { error: updateError } = await db
      .from("execution_jobs")
      .update({ status: "RUNNING", updated_at: now })
      .eq("id", row.id);
    throwIfError(updateError, null);
    row.status = "RUNNING";
  }

  return rows;
}

export async function markExecutionJobExecuted(id: number, txHash: string): Promise<void> {
  const db = supabase();
  const { error } = await db
    .from("execution_jobs")
    .update({ status: "EXECUTED", tx_hash: txHash.toLowerCase(), updated_at: nowMs() })
    .eq("id", id);
  throwIfError(error, null);
}

export async function markExecutionJobExecutedByIntent(input: {
  fundId: string;
  intentHash: string;
  txHash: string;
}): Promise<void> {
  const db = supabase();
  const now = nowMs();
  const key = input.intentHash.toLowerCase();
  const { error } = await db
    .from("execution_jobs")
    .update({
      status: "EXECUTED",
      tx_hash: input.txHash.toLowerCase(),
      updated_at: now
    })
    .eq("fund_id", input.fundId)
    .eq("intent_hash", key);
  throwIfError(error, null);
}

export async function markExecutionJobRetryableByIntent(input: {
  fundId: string;
  intentHash: string;
  error: string;
  retryDelayMs: number;
}): Promise<void> {
  const db = supabase();
  const now = nowMs();
  const key = input.intentHash.toLowerCase();
  const { data: current, error: findError } = await db
    .from("execution_jobs")
    .select("attempt_count")
    .eq("fund_id", input.fundId)
    .eq("intent_hash", key)
    .maybeSingle();
  throwIfError(findError, null);

  const attemptCount = Number(current?.attempt_count ?? 0) + 1;
  const { error } = await db
    .from("execution_jobs")
    .update({
      status: "FAILED_RETRYABLE",
      attempt_count: attemptCount,
      next_run_at: now + Math.max(0, input.retryDelayMs),
      last_error: input.error,
      updated_at: now
    })
    .eq("fund_id", input.fundId)
    .eq("intent_hash", key);
  throwIfError(error, null);
}

export async function markExecutionJobFailed(input: {
  id: number;
  attemptCount: number;
  retryDelayMs: number;
  maxAttempts: number;
  error: string;
}): Promise<void> {
  const db = supabase();
  const now = nowMs();
  const final = input.attemptCount >= input.maxAttempts;
  const { error } = await db
    .from("execution_jobs")
    .update({
      status: final ? "FAILED_FINAL" : "FAILED_RETRYABLE",
      attempt_count: input.attemptCount,
      next_run_at: now + input.retryDelayMs,
      last_error: input.error,
      updated_at: now
    })
    .eq("id", input.id);
  throwIfError(error, null);
}

export async function insertAllocationClaim(input: {
  fundId: string;
  claimHash: string;
  epochId: bigint;
  participant: string;
  claimJson: string;
  createdBy: string;
}): Promise<{ ok: true; id: number } | { ok: false; reason: "DUPLICATE" }> {
  const db = supabase();
  const now = nowMs();
  const { data, error } = await db
    .from("allocation_claims")
    .insert({
      fund_id: input.fundId,
      claim_hash: input.claimHash.toLowerCase(),
      epoch_id: input.epochId.toString(),
      participant: input.participant.toLowerCase(),
      claim_json: input.claimJson,
      created_by: input.createdBy,
      created_at: now,
      updated_at: now
    })
    .select("id")
    .single();

  if (error) {
    if (isDuplicateError(error)) return { ok: false, reason: "DUPLICATE" };
    throwIfError(error, null);
  }

  return { ok: true, id: Number(data!.id) };
}

export async function listAllocationClaimsByFund(input: {
  fundId: string;
  epochId?: bigint;
  limit: number;
  offset: number;
}) {
  const db = supabase();
  let query = db
    .from("allocation_claims")
    .select(
      "id,fund_id,claim_hash,epoch_id,participant,claim_json,created_by,created_at,updated_at",
      { count: "exact" }
    )
    .eq("fund_id", input.fundId);
  if (input.epochId !== undefined) {
    query = query.eq("epoch_id", input.epochId.toString());
  }
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(input.offset, input.offset + Math.max(input.limit - 1, 0));
  throwIfError(error, null);

  return {
    rows: (data ?? []) as AllocationClaimRow[],
    total: Number(count ?? 0)
  };
}

export async function listAllocationClaimsByEpoch(input: {
  fundId: string;
  epochId: bigint;
}): Promise<AllocationClaimRow[]> {
  const db = supabase();
  const { data, error } = await db
    .from("allocation_claims")
    .select("id,fund_id,claim_hash,epoch_id,participant,claim_json,created_by,created_at,updated_at")
    .eq("fund_id", input.fundId)
    .eq("epoch_id", input.epochId.toString())
    .order("created_at", { ascending: true });
  throwIfError(error, null);
  return (data ?? []) as AllocationClaimRow[];
}

export async function upsertEpochState(input: {
  fundId: string;
  epochId: bigint;
  epochStateHash: string;
  aggregateWeightsJson: string;
  claimHashes: string[];
}): Promise<void> {
  const db = supabase();
  const now = nowMs();
  const { error } = await db.from("epoch_states").upsert(
    {
      fund_id: input.fundId,
      epoch_id: input.epochId.toString(),
      epoch_state_hash: input.epochStateHash.toLowerCase(),
      aggregate_weights_json: input.aggregateWeightsJson,
      claim_hashes_json: JSON.stringify(input.claimHashes.map((h) => h.toLowerCase())),
      claim_count: input.claimHashes.length,
      finalized_at: now,
      created_at: now,
      updated_at: now
    },
    {
      onConflict: "fund_id,epoch_id"
    }
  );
  throwIfError(error, null);
}

export async function getLatestEpochState(fundId: string): Promise<EpochStateRow | undefined> {
  const db = supabase();
  const { data, error } = await db
    .from("epoch_states")
    .select("*")
    .eq("fund_id", fundId)
    .order("finalized_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  throwIfError(error, null);
  return (data as EpochStateRow | null) ?? undefined;
}

export async function getEpochStateByEpoch(input: {
  fundId: string;
  epochId: bigint;
}): Promise<EpochStateRow | undefined> {
  const db = supabase();
  const { data, error } = await db
    .from("epoch_states")
    .select("*")
    .eq("fund_id", input.fundId)
    .eq("epoch_id", input.epochId.toString())
    .maybeSingle();
  throwIfError(error, null);
  return (data as EpochStateRow | null) ?? undefined;
}

export async function upsertStakeWeight(input: {
  fundId: string;
  participant: string;
  weight: bigint;
  epochId?: string;
}): Promise<void> {
  const db = supabase();
  const now = nowMs();
  const { error } = await db.from("stake_weights").upsert(
    {
      fund_id: input.fundId,
      participant: input.participant.toLowerCase(),
      weight: input.weight.toString(),
      epoch_id: input.epochId ?? "__global__",
      created_at: now,
      updated_at: now
    },
    { onConflict: "fund_id,participant,epoch_id" }
  );
  throwIfError(error, null);
}

export async function listStakeWeightsByFund(
  fundId: string
): Promise<Array<{ participant: string; weight: bigint }>> {
  const db = supabase();
  const { data, error } = await db
    .from("stake_weights")
    .select("participant,weight,epoch_id,updated_at")
    .eq("fund_id", fundId)
    .order("updated_at", { ascending: false });
  throwIfError(error, null);

  const latest = new Map<string, bigint>();
  for (const row of (data ?? []) as Array<{ participant: string; weight: string }>) {
    const key = String(row.participant).toLowerCase();
    if (latest.has(key)) continue;
    latest.set(key, BigInt(String(row.weight)));
  }

  return Array.from(latest.entries()).map(([participant, weight]) => ({
    participant,
    weight
  }));
}

export async function openEpoch(input: {
  fundId: string;
  epochId: string;
  closesAt: number;
}): Promise<EpochLifecycleRow> {
  const db = supabase();
  const now = nowMs();
  const { data, error } = await db
    .from("epoch_lifecycle")
    .insert({
      fund_id: input.fundId,
      epoch_id: input.epochId,
      status: "OPEN",
      opened_at: now,
      closes_at: input.closesAt,
      closed_at: null,
      claim_count: 0,
      created_at: now,
      updated_at: now
    })
    .select("*")
    .single();
  throwIfError(error, null);
  return data as EpochLifecycleRow;
}

export async function getActiveEpoch(fundId: string): Promise<EpochLifecycleRow | undefined> {
  const db = supabase();
  const { data, error } = await db
    .from("epoch_lifecycle")
    .select("*")
    .eq("fund_id", fundId)
    .eq("status", "OPEN")
    .maybeSingle();
  throwIfError(error, null);
  return (data as EpochLifecycleRow | null) ?? undefined;
}

export async function closeEpoch(input: {
  fundId: string;
  epochId: string;
}): Promise<void> {
  const db = supabase();
  const now = nowMs();
  const { data, error } = await db
    .from("epoch_lifecycle")
    .update({ status: "CLOSED", closed_at: now, updated_at: now })
    .eq("fund_id", input.fundId)
    .eq("epoch_id", input.epochId)
    .eq("status", "OPEN")
    .select("id");
  throwIfError(error, null);
  if (!data || data.length === 0) {
    throw new Error(`closeEpoch: no OPEN epoch for fund=${input.fundId} epoch=${input.epochId}`);
  }
}

export async function markEpochAggregated(input: {
  fundId: string;
  epochId: string;
}): Promise<void> {
  const db = supabase();
  const now = nowMs();
  const { data, error } = await db
    .from("epoch_lifecycle")
    .update({ status: "AGGREGATED", updated_at: now })
    .eq("fund_id", input.fundId)
    .eq("epoch_id", input.epochId)
    .eq("status", "CLOSED")
    .select("id");
  throwIfError(error, null);
  if (!data || data.length === 0) {
    throw new Error(
      `markEpochAggregated: no CLOSED epoch for fund=${input.fundId} epoch=${input.epochId}`
    );
  }
}

export async function incrementEpochClaimCount(input: {
  fundId: string;
  epochId: string;
}): Promise<number> {
  const db = supabase();
  const { data, error } = await db.rpc("increment_epoch_claim_count_atomic", {
    p_fund_id: input.fundId,
    p_epoch_id: input.epochId
  });
  throwIfError(error, null);
  return Number((data as Array<{ claim_count: number }>)?.[0]?.claim_count ?? 0);
}

export async function extendEpoch(input: {
  fundId: string;
  epochId: string;
  newClosesAt: number;
}): Promise<void> {
  const db = supabase();
  const now = nowMs();
  const { error } = await db
    .from("epoch_lifecycle")
    .update({ closes_at: input.newClosesAt, updated_at: now })
    .eq("fund_id", input.fundId)
    .eq("epoch_id", input.epochId)
    .eq("status", "OPEN");
  throwIfError(error, null);
}

export async function listActionableFunds(input: {
  nowMs: number;
  limit?: number;
}): Promise<
  Array<{
    fundId: string;
    epochDurationMs: number;
    epochMinClaims: number;
    epochMaxClaims: number;
    activeEpoch: EpochLifecycleRow | null;
  }>
> {
  const db = supabase();
  const limit = input.limit ?? 50;

  const { data: funds, error: fundsError } = await db
    .from("funds")
    .select("fund_id,epoch_duration_ms,epoch_min_claims,epoch_max_claims")
    .eq("auto_epoch_enabled", true)
    .limit(limit);
  throwIfError(fundsError, null);
  if (!funds || funds.length === 0) return [];

  const fundIds = (funds as Array<{ fund_id: string }>).map((f) => f.fund_id);
  const { data: epochs, error: epochsError } = await db
    .from("epoch_lifecycle")
    .select("*")
    .in("fund_id", fundIds)
    .eq("status", "OPEN");
  throwIfError(epochsError, null);

  const epochMap = new Map<string, EpochLifecycleRow>();
  for (const epoch of (epochs ?? []) as EpochLifecycleRow[]) {
    epochMap.set(epoch.fund_id, epoch);
  }

  return (funds as Array<{
    fund_id: string;
    epoch_duration_ms: number;
    epoch_min_claims: number;
    epoch_max_claims: number;
  }>).map((f) => ({
    fundId: f.fund_id,
    epochDurationMs: Number(f.epoch_duration_ms),
    epochMinClaims: Number(f.epoch_min_claims),
    epochMaxClaims: Number(f.epoch_max_claims),
    activeEpoch: epochMap.get(f.fund_id) ?? null
  }));
}

export async function insertOutboxEvent(input: {
  eventType: string;
  fundId: string;
  payload: Record<string, unknown>;
}): Promise<EventsOutboxRow> {
  const db = supabase();
  const now = nowMs();
  const { data, error } = await db
    .from("events_outbox")
    .insert({
      event_type: input.eventType,
      fund_id: input.fundId,
      payload: input.payload,
      created_at: now
    })
    .select("*")
    .single();
  throwIfError(error, null);
  return data as EventsOutboxRow;
}

export async function listOutboxEventsSince(input: {
  fundId: string;
  afterId: number;
  eventTypes?: string[];
  limit?: number;
}): Promise<EventsOutboxRow[]> {
  const db = supabase();
  let query = db
    .from("events_outbox")
    .select("*")
    .eq("fund_id", input.fundId)
    .gt("id", input.afterId)
    .order("id", { ascending: true })
    .limit(input.limit ?? 100);
  if (input.eventTypes && input.eventTypes.length > 0) {
    query = query.in("event_type", input.eventTypes);
  }
  const { data, error } = await query;
  throwIfError(error, null);
  return (data ?? []) as EventsOutboxRow[];
}
