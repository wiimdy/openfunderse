import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type SubjectType = "CLAIM" | "INTENT";
export type RecordStatus = "PENDING" | "APPROVED" | "REJECTED";

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

export type ExecutionJobStatus =
  | "READY"
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

let supabaseSingleton: SupabaseClient | null = null;

function envFirst(...keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key];
    if (value && value.length > 0) return value;
  }
  throw new Error(`missing required env: one of [${keys.join(", ")}]`);
}

function supabase(): SupabaseClient {
  if (supabaseSingleton) return supabaseSingleton;

  const url = envFirst("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL");
  const key = envFirst(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_ANON_KEY"
  );

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
  createdBy: string;
}) {
  const db = supabase();
  const now = nowMs();
  const { error } = await db.from("funds").upsert(
    {
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
    },
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
      "fund_id,fund_name,strategy_bot_id,strategy_bot_address,verifier_threshold_weight,intent_threshold_weight,strategy_policy_uri,telegram_room_id,created_by,created_at,updated_at"
    )
    .eq("fund_id", fundId)
    .maybeSingle();
  throwIfError(error, null);
  return data ?? undefined;
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

export async function insertAttestation(input: {
  fundId: string;
  subjectType: SubjectType;
  subjectHash: string;
  epochId: bigint | null;
  verifier: string;
  expiresAt: bigint;
  nonce: bigint;
  signature: string;
}): Promise<{ ok: true; id: number } | { ok: false; reason: "DUPLICATE" }> {
  const db = supabase();
  const now = nowMs();
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
      status: "PENDING",
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
    .eq("subject_type", input.subjectType)
    .eq("subject_hash", key);
  throwIfError(error, null);
}

export async function incrementSubjectAttestedWeight(
  subjectType: SubjectType,
  subjectHash: string,
  delta: bigint
): Promise<bigint> {
  if (delta < BigInt(0)) throw new Error("delta must be non-negative");
  const db = supabase();
  const key = subjectHash.toLowerCase();

  const { data: current, error: currentError } = await db
    .from("subject_state")
    .select("attested_weight")
    .eq("subject_type", subjectType)
    .eq("subject_hash", key)
    .maybeSingle();
  throwIfError(currentError, null);

  const prev = current ? BigInt(current.attested_weight) : BigInt(0);
  const next = prev + delta;

  const { error } = await db
    .from("subject_state")
    .update({ attested_weight: next.toString(), updated_at: nowMs() })
    .eq("subject_type", subjectType)
    .eq("subject_hash", key);
  throwIfError(error, null);

  return next;
}

export async function getSubjectState(subjectType: SubjectType, subjectHash: string) {
  const db = supabase();
  const { data, error } = await db
    .from("subject_state")
    .select("threshold_weight,attested_weight,status,submit_attempts")
    .eq("subject_type", subjectType)
    .eq("subject_hash", subjectHash.toLowerCase())
    .maybeSingle();
  throwIfError(error, null);
  return (data as
    | {
        threshold_weight: string;
        attested_weight: string;
        status: RecordStatus;
        submit_attempts: number;
      }
    | null) ?? undefined;
}

export async function listPendingAttestations(
  subjectType: SubjectType,
  subjectHash: string
): Promise<AttestationRow[]> {
  const db = supabase();
  const { data, error } = await db
    .from("attestations")
    .select("*")
    .eq("subject_type", subjectType)
    .eq("subject_hash", subjectHash.toLowerCase())
    .eq("status", "PENDING")
    .order("created_at", { ascending: true });
  throwIfError(error, null);
  return (data ?? []) as AttestationRow[];
}

export async function markSubjectApproved(input: {
  subjectType: SubjectType;
  subjectHash: string;
  txHash: string;
}): Promise<void> {
  const db = supabase();
  const now = nowMs();
  const key = input.subjectHash.toLowerCase();
  const txHash = input.txHash.toLowerCase();

  {
    const { error } = await db
      .from("subject_state")
      .update({ status: "APPROVED", tx_hash: txHash, updated_at: now })
      .eq("subject_type", input.subjectType)
      .eq("subject_hash", key);
    throwIfError(error, null);
  }

  {
    const { error } = await db
      .from("attestations")
      .update({ status: "APPROVED", tx_hash: txHash, updated_at: now })
      .eq("subject_type", input.subjectType)
      .eq("subject_hash", key)
      .eq("status", "PENDING");
    throwIfError(error, null);
  }

  if (input.subjectType === "CLAIM") {
    const { error } = await db
      .from("claims")
      .update({ status: "APPROVED", updated_at: now })
      .eq("claim_hash", key);
    throwIfError(error, null);
    return;
  }

  {
    const { error } = await db
      .from("intents")
      .update({ status: "APPROVED", updated_at: now })
      .eq("intent_hash", key);
    throwIfError(error, null);
  }

  const { data: intent, error: intentError } = await db
    .from("intents")
    .select("fund_id")
    .eq("intent_hash", key)
    .maybeSingle();
  throwIfError(intentError, null);

  if (intent?.fund_id) {
    const { error } = await db.from("execution_jobs").upsert(
      {
        fund_id: intent.fund_id,
        intent_hash: key,
        status: "READY",
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
  const { data, error } = await db
    .from("subject_state")
    .select("subject_type,status,threshold_weight,attested_weight")
    .eq("fund_id", fundId);
  throwIfError(error, null);

  let claimsPending = 0;
  let claimsApproved = 0;
  let intentsPending = 0;
  let intentsApproved = 0;

  let claimAttestedWeight = BigInt(0);
  let claimThresholdWeight = BigInt(0);
  let intentAttestedWeight = BigInt(0);
  let intentThresholdWeight = BigInt(0);

  for (const row of (data ?? []) as Array<{
    subject_type: SubjectType;
    status: RecordStatus;
    threshold_weight: string;
    attested_weight: string;
  }>) {
    if (row.subject_type === "CLAIM") {
      if (row.status === "PENDING") claimsPending += 1;
      if (row.status === "APPROVED") claimsApproved += 1;
      claimAttestedWeight += BigInt(row.attested_weight);
      claimThresholdWeight += BigInt(row.threshold_weight);
    } else {
      if (row.status === "PENDING") intentsPending += 1;
      if (row.status === "APPROVED") intentsApproved += 1;
      intentAttestedWeight += BigInt(row.attested_weight);
      intentThresholdWeight += BigInt(row.threshold_weight);
    }
  }

  return {
    claims: {
      pending: claimsPending,
      approved: claimsApproved,
      attestedWeight: claimAttestedWeight.toString(),
      thresholdWeight: claimThresholdWeight.toString()
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
    .in("status", ["READY", "FAILED_RETRYABLE"])
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
