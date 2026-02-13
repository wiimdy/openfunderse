import postgres from "postgres";

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

let sqlSingleton: postgres.Sql | null = null;
let initPromise: Promise<void> | null = null;

function dbUrl(): string {
  return (
    process.env.SUPABASE_DB_URL ||
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    ""
  );
}

function sql(): postgres.Sql {
  if (sqlSingleton) return sqlSingleton;

  const url = dbUrl();
  if (!url) {
    throw new Error(
      "missing required env: SUPABASE_DB_URL (or POSTGRES_URL / DATABASE_URL)"
    );
  }

  sqlSingleton = postgres(url, {
    max: Number(process.env.PG_POOL_MAX ?? 10),
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: true
  });
  return sqlSingleton;
}

async function initSchema(): Promise<void> {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const db = sql();
    await db`
      CREATE TABLE IF NOT EXISTS funds (
        id BIGSERIAL PRIMARY KEY,
        fund_id TEXT NOT NULL UNIQUE,
        fund_name TEXT NOT NULL,
        strategy_bot_id TEXT NOT NULL DEFAULT '',
        strategy_bot_address TEXT NOT NULL DEFAULT '',
        verifier_threshold_weight TEXT NOT NULL,
        intent_threshold_weight TEXT NOT NULL,
        strategy_policy_uri TEXT,
        telegram_room_id TEXT,
        created_by TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )
    `;

    await db`
      CREATE TABLE IF NOT EXISTS fund_bots (
        id BIGSERIAL PRIMARY KEY,
        fund_id TEXT NOT NULL,
        bot_id TEXT NOT NULL,
        role TEXT NOT NULL,
        bot_address TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        policy_uri TEXT,
        telegram_handle TEXT,
        registered_by TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        UNIQUE(fund_id, bot_id)
      )
    `;

    await db`
      CREATE TABLE IF NOT EXISTS attestations (
        id BIGSERIAL PRIMARY KEY,
        fund_id TEXT NOT NULL,
        subject_type TEXT NOT NULL,
        subject_hash TEXT NOT NULL,
        epoch_id TEXT,
        verifier TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        nonce TEXT NOT NULL,
        signature TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        tx_hash TEXT,
        error TEXT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        UNIQUE(subject_type, subject_hash, verifier)
      )
    `;

    await db`
      CREATE TABLE IF NOT EXISTS subject_state (
        id BIGSERIAL PRIMARY KEY,
        fund_id TEXT NOT NULL,
        subject_type TEXT NOT NULL,
        subject_hash TEXT NOT NULL,
        epoch_id TEXT,
        threshold_weight TEXT NOT NULL DEFAULT '0',
        attested_weight TEXT NOT NULL DEFAULT '0',
        status TEXT NOT NULL DEFAULT 'PENDING',
        tx_hash TEXT,
        submit_attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        UNIQUE(subject_type, subject_hash)
      )
    `;

    await db`
      CREATE TABLE IF NOT EXISTS claims (
        id BIGSERIAL PRIMARY KEY,
        fund_id TEXT NOT NULL,
        claim_hash TEXT NOT NULL,
        epoch_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        created_by TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        UNIQUE(fund_id, claim_hash)
      )
    `;

    await db`
      CREATE TABLE IF NOT EXISTS snapshots (
        id BIGSERIAL PRIMARY KEY,
        fund_id TEXT NOT NULL,
        epoch_id TEXT NOT NULL,
        snapshot_hash TEXT NOT NULL,
        claim_hashes_json TEXT NOT NULL,
        claim_count INTEGER NOT NULL,
        finalized_at BIGINT NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        UNIQUE(fund_id, epoch_id)
      )
    `;

    await db`
      CREATE TABLE IF NOT EXISTS intents (
        id BIGSERIAL PRIMARY KEY,
        fund_id TEXT NOT NULL,
        intent_hash TEXT NOT NULL,
        snapshot_hash TEXT NOT NULL,
        intent_uri TEXT,
        intent_json TEXT NOT NULL,
        execution_route_json TEXT NOT NULL DEFAULT '{}',
        allowlist_hash TEXT NOT NULL,
        max_slippage_bps TEXT NOT NULL,
        max_notional TEXT NOT NULL,
        deadline TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        created_by TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        UNIQUE(fund_id, intent_hash)
      )
    `;

    await db`
      CREATE TABLE IF NOT EXISTS execution_jobs (
        id BIGSERIAL PRIMARY KEY,
        fund_id TEXT NOT NULL,
        intent_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'READY',
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_run_at BIGINT NOT NULL,
        tx_hash TEXT,
        last_error TEXT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        UNIQUE(fund_id, intent_hash)
      )
    `;

    await db`CREATE INDEX IF NOT EXISTS idx_attestations_subject ON attestations(subject_type, subject_hash, status)`;
    await db`CREATE INDEX IF NOT EXISTS idx_fund_bots_fund ON fund_bots(fund_id, status)`;
    await db`CREATE INDEX IF NOT EXISTS idx_claims_fund_epoch ON claims(fund_id, epoch_id, created_at DESC)`;
    await db`CREATE INDEX IF NOT EXISTS idx_snapshots_fund_finalized ON snapshots(fund_id, finalized_at DESC)`;
    await db`CREATE INDEX IF NOT EXISTS idx_intents_fund_snapshot ON intents(fund_id, snapshot_hash, created_at DESC)`;
    await db`CREATE INDEX IF NOT EXISTS idx_execution_jobs_status_next ON execution_jobs(status, next_run_at, created_at)`;
  })();

  return initPromise;
}

function nowMs(): number {
  return Date.now();
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
  await initSchema();
  const db = sql();
  const now = nowMs();
  await db`
    INSERT INTO funds (
      fund_id, fund_name, strategy_bot_id, strategy_bot_address, verifier_threshold_weight, intent_threshold_weight,
      strategy_policy_uri, telegram_room_id, created_by, created_at, updated_at
    ) VALUES (
      ${input.fundId}, ${input.fundName}, ${input.strategyBotId}, ${input.strategyBotAddress},
      ${input.verifierThresholdWeight.toString()}, ${input.intentThresholdWeight.toString()},
      ${input.strategyPolicyUri}, ${input.telegramRoomId}, ${input.createdBy}, ${now}, ${now}
    )
    ON CONFLICT (fund_id) DO UPDATE SET
      fund_name = EXCLUDED.fund_name,
      strategy_bot_id = EXCLUDED.strategy_bot_id,
      strategy_bot_address = EXCLUDED.strategy_bot_address,
      verifier_threshold_weight = EXCLUDED.verifier_threshold_weight,
      intent_threshold_weight = EXCLUDED.intent_threshold_weight,
      strategy_policy_uri = EXCLUDED.strategy_policy_uri,
      telegram_room_id = EXCLUDED.telegram_room_id,
      updated_at = EXCLUDED.updated_at
  `;
}

export async function getFund(fundId: string) {
  await initSchema();
  const db = sql();
  const rows = await db`
    SELECT
      fund_id, fund_name, strategy_bot_id, strategy_bot_address, verifier_threshold_weight, intent_threshold_weight,
      strategy_policy_uri, telegram_room_id, created_by, created_at, updated_at
    FROM funds
    WHERE fund_id = ${fundId}
    LIMIT 1
  `;
  return rows[0] as
    | {
        fund_id: string;
        fund_name: string;
        strategy_bot_id: string;
        strategy_bot_address: string;
        verifier_threshold_weight: string;
        intent_threshold_weight: string;
        strategy_policy_uri: string | null;
        telegram_room_id: string | null;
        created_by: string;
        created_at: number;
        updated_at: number;
      }
    | undefined;
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
  await initSchema();
  const db = sql();
  const now = nowMs();
  await db`
    INSERT INTO fund_bots (
      fund_id, bot_id, role, bot_address, status,
      policy_uri, telegram_handle, registered_by, created_at, updated_at
    ) VALUES (
      ${input.fundId}, ${input.botId}, ${input.role}, ${input.botAddress}, ${input.status},
      ${input.policyUri}, ${input.telegramHandle}, ${input.registeredBy}, ${now}, ${now}
    )
    ON CONFLICT (fund_id, bot_id) DO UPDATE SET
      role = EXCLUDED.role,
      bot_address = EXCLUDED.bot_address,
      status = EXCLUDED.status,
      policy_uri = EXCLUDED.policy_uri,
      telegram_handle = EXCLUDED.telegram_handle,
      registered_by = EXCLUDED.registered_by,
      updated_at = EXCLUDED.updated_at
  `;
}

export async function listFundBots(fundId: string) {
  await initSchema();
  const db = sql();
  const rows = await db`
    SELECT
      fund_id, bot_id, role, bot_address, status,
      policy_uri, telegram_handle, registered_by, created_at, updated_at
    FROM fund_bots
    WHERE fund_id = ${fundId}
    ORDER BY created_at ASC
  `;
  return rows as unknown as Array<{
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
  await initSchema();
  const db = sql();
  const now = nowMs();
  try {
    const rows = await db`
      INSERT INTO attestations (
        fund_id, subject_type, subject_hash, epoch_id,
        verifier, expires_at, nonce, signature,
        status, created_at, updated_at
      ) VALUES (
        ${input.fundId}, ${input.subjectType}, ${input.subjectHash.toLowerCase()},
        ${input.epochId === null ? null : input.epochId.toString()},
        ${input.verifier.toLowerCase()}, ${input.expiresAt.toString()}, ${input.nonce.toString()}, ${input.signature},
        'PENDING', ${now}, ${now}
      )
      RETURNING id
    `;
    return { ok: true, id: Number(rows[0].id) };
  } catch (error) {
    if (String(error).includes("duplicate key value")) {
      return { ok: false, reason: "DUPLICATE" };
    }
    throw error;
  }
}

export async function upsertSubjectState(input: {
  fundId: string;
  subjectType: SubjectType;
  subjectHash: string;
  epochId: bigint | null;
  thresholdWeight: bigint;
}): Promise<void> {
  await initSchema();
  const db = sql();
  const now = nowMs();
  await db`
    INSERT INTO subject_state (
      fund_id, subject_type, subject_hash, epoch_id,
      threshold_weight, attested_weight, status, created_at, updated_at
    ) VALUES (
      ${input.fundId}, ${input.subjectType}, ${input.subjectHash.toLowerCase()},
      ${input.epochId === null ? null : input.epochId.toString()},
      ${input.thresholdWeight.toString()}, '0', 'PENDING', ${now}, ${now}
    )
    ON CONFLICT (subject_type, subject_hash) DO UPDATE SET
      threshold_weight = EXCLUDED.threshold_weight,
      updated_at = EXCLUDED.updated_at
  `;
}

export async function incrementSubjectAttestedWeight(
  subjectType: SubjectType,
  subjectHash: string,
  delta: bigint
): Promise<bigint> {
  if (delta < BigInt(0)) throw new Error("delta must be non-negative");
  await initSchema();
  const db = sql();
  const key = subjectHash.toLowerCase();

  const rows = await db`
    SELECT attested_weight FROM subject_state
    WHERE subject_type = ${subjectType} AND subject_hash = ${key}
    LIMIT 1
  `;
  const prev = rows[0] ? BigInt(rows[0].attested_weight) : BigInt(0);
  const next = prev + delta;

  await db`
    UPDATE subject_state
    SET attested_weight = ${next.toString()}, updated_at = ${nowMs()}
    WHERE subject_type = ${subjectType} AND subject_hash = ${key}
  `;

  return next;
}

export async function getSubjectState(subjectType: SubjectType, subjectHash: string) {
  await initSchema();
  const db = sql();
  const rows = await db`
    SELECT threshold_weight, attested_weight, status, submit_attempts
    FROM subject_state
    WHERE subject_type = ${subjectType} AND subject_hash = ${subjectHash.toLowerCase()}
    LIMIT 1
  `;
  return rows[0] as
    | {
        threshold_weight: string;
        attested_weight: string;
        status: RecordStatus;
        submit_attempts: number;
      }
    | undefined;
}

export async function listPendingAttestations(
  subjectType: SubjectType,
  subjectHash: string
): Promise<AttestationRow[]> {
  await initSchema();
  const db = sql();
  const rows = await db`
    SELECT * FROM attestations
    WHERE subject_type = ${subjectType} AND subject_hash = ${subjectHash.toLowerCase()} AND status = 'PENDING'
    ORDER BY created_at ASC
  `;
  return rows as unknown as AttestationRow[];
}

export async function markSubjectApproved(input: {
  subjectType: SubjectType;
  subjectHash: string;
  txHash: string;
}): Promise<void> {
  await initSchema();
  const db = sql();
  const now = nowMs();
  const key = input.subjectHash.toLowerCase();

  await db.begin(async (tx) => {
    await tx.unsafe(
      `
      UPDATE subject_state
      SET status = 'APPROVED', tx_hash = $1, updated_at = $2
      WHERE subject_type = $3 AND subject_hash = $4
      `,
      [input.txHash.toLowerCase(), now, input.subjectType, key]
    );

    await tx.unsafe(
      `
      UPDATE attestations
      SET status = 'APPROVED', tx_hash = $1, updated_at = $2
      WHERE subject_type = $3 AND subject_hash = $4 AND status = 'PENDING'
      `,
      [input.txHash.toLowerCase(), now, input.subjectType, key]
    );

    if (input.subjectType === "CLAIM") {
      await tx.unsafe(
        `
        UPDATE claims
        SET status = 'APPROVED', updated_at = $1
        WHERE claim_hash = $2
        `,
        [now, key]
      );
      return;
    }

    await tx.unsafe(
      `
      UPDATE intents
      SET status = 'APPROVED', updated_at = $1
      WHERE intent_hash = $2
      `,
      [now, key]
    );

    const intentRows = await tx.unsafe(
      `SELECT fund_id FROM intents WHERE intent_hash = $1 LIMIT 1`,
      [key]
    );
    const fundId = (intentRows as unknown as Array<{ fund_id: string }>)[0]?.fund_id;
    if (fundId) {
      await tx.unsafe(
        `
        INSERT INTO execution_jobs (
          fund_id, intent_hash, status, attempt_count, next_run_at, created_at, updated_at
        ) VALUES ($1, $2, 'READY', 0, $3, $4, $5)
        ON CONFLICT (fund_id, intent_hash) DO UPDATE SET
          status = 'READY', next_run_at = EXCLUDED.next_run_at, updated_at = EXCLUDED.updated_at
        `,
        [fundId, key, now, now, now]
      );
    }
  });
}

export async function markSubjectSubmitError(input: {
  subjectType: SubjectType;
  subjectHash: string;
  message: string;
}): Promise<void> {
  await initSchema();
  const db = sql();
  await db`
    UPDATE subject_state
    SET submit_attempts = submit_attempts + 1,
        last_error = ${input.message},
        updated_at = ${nowMs()}
    WHERE subject_type = ${input.subjectType} AND subject_hash = ${input.subjectHash.toLowerCase()}
  `;
}

export async function getStatusSummary(fundId: string) {
  await initSchema();
  const db = sql();

  const claim = await db`
    SELECT
      SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END)::bigint AS pending,
      SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END)::bigint AS approved
    FROM subject_state
    WHERE fund_id = ${fundId} AND subject_type = 'CLAIM'
  `;

  const intent = await db`
    SELECT
      SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END)::bigint AS pending,
      SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END)::bigint AS approved
    FROM subject_state
    WHERE fund_id = ${fundId} AND subject_type = 'INTENT'
  `;

  const rows = await db`
    SELECT subject_type, status, threshold_weight, attested_weight
    FROM subject_state
    WHERE fund_id = ${fundId}
  `;

  let claimAttestedWeight = BigInt(0);
  let claimThresholdWeight = BigInt(0);
  let intentAttestedWeight = BigInt(0);
  let intentThresholdWeight = BigInt(0);

  for (const row of rows as unknown as Array<{ subject_type: SubjectType; threshold_weight: string; attested_weight: string }>) {
    if (row.subject_type === "CLAIM") {
      claimAttestedWeight += BigInt(row.attested_weight);
      claimThresholdWeight += BigInt(row.threshold_weight);
    } else {
      intentAttestedWeight += BigInt(row.attested_weight);
      intentThresholdWeight += BigInt(row.threshold_weight);
    }
  }

  return {
    claims: {
      pending: Number(claim[0]?.pending ?? 0),
      approved: Number(claim[0]?.approved ?? 0),
      attestedWeight: claimAttestedWeight.toString(),
      thresholdWeight: claimThresholdWeight.toString()
    },
    intents: {
      pending: Number(intent[0]?.pending ?? 0),
      approved: Number(intent[0]?.approved ?? 0),
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
  await initSchema();
  const db = sql();
  const now = nowMs();
  try {
    const rows = await db`
      INSERT INTO claims (
        fund_id, claim_hash, epoch_id, payload_json, status, created_by, created_at, updated_at
      ) VALUES (
        ${input.fundId}, ${input.claimHash.toLowerCase()}, ${input.epochId.toString()}, ${input.payloadJson},
        'PENDING', ${input.createdBy}, ${now}, ${now}
      )
      RETURNING id
    `;
    return { ok: true, id: Number(rows[0].id) };
  } catch (error) {
    if (String(error).includes("duplicate key value")) {
      return { ok: false, reason: "DUPLICATE" };
    }
    throw error;
  }
}

export async function listClaimsByFund(input: {
  fundId: string;
  status?: RecordStatus;
  epochId?: bigint;
  limit: number;
  offset: number;
}) {
  await initSchema();
  const db = sql();

  const where: string[] = ["c.fund_id = $1"];
  const params: Array<string | number> = [input.fundId];
  let idx = 2;

  if (input.status) {
    where.push(`COALESCE(ss.status, c.status) = $${idx++}`);
    params.push(input.status);
  }
  if (input.epochId !== undefined) {
    where.push(`c.epoch_id = $${idx++}`);
    params.push(input.epochId.toString());
  }

  const whereClause = where.join(" AND ");

  const rows = await db.unsafe(
    `
      SELECT
        c.id, c.fund_id, c.claim_hash, c.epoch_id, c.payload_json,
        COALESCE(ss.status, c.status) AS status,
        COALESCE(ss.attested_weight, '0') AS attested_weight,
        COALESCE(ss.threshold_weight, '0') AS threshold_weight,
        (
          SELECT COUNT(1)
          FROM attestations a
          WHERE a.subject_type = 'CLAIM' AND a.subject_hash = c.claim_hash
        ) AS attestation_count,
        c.created_by, c.created_at, c.updated_at
      FROM claims c
      LEFT JOIN subject_state ss
        ON ss.subject_type = 'CLAIM' AND ss.subject_hash = c.claim_hash
      WHERE ${whereClause}
      ORDER BY c.created_at DESC
      LIMIT $${idx++} OFFSET $${idx}
    `,
    [...params, input.limit, input.offset]
  );

  const totalRows = await db.unsafe(
    `
      SELECT COUNT(1) AS count
      FROM claims c
      LEFT JOIN subject_state ss
        ON ss.subject_type = 'CLAIM' AND ss.subject_hash = c.claim_hash
      WHERE ${whereClause}
    `,
    params
  );

  return {
    rows: rows as unknown as Array<{
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
    total: Number(totalRows[0]?.count ?? 0)
  };
}

export async function upsertSnapshot(input: {
  fundId: string;
  epochId: bigint;
  snapshotHash: string;
  claimHashes: string[];
}): Promise<void> {
  await initSchema();
  const db = sql();
  const now = nowMs();
  await db`
    INSERT INTO snapshots (
      fund_id, epoch_id, snapshot_hash, claim_hashes_json, claim_count, finalized_at, created_at, updated_at
    ) VALUES (
      ${input.fundId}, ${input.epochId.toString()}, ${input.snapshotHash.toLowerCase()},
      ${JSON.stringify(input.claimHashes.map((h) => h.toLowerCase()))}, ${input.claimHashes.length}, ${now}, ${now}, ${now}
    )
    ON CONFLICT (fund_id, epoch_id) DO UPDATE SET
      snapshot_hash = EXCLUDED.snapshot_hash,
      claim_hashes_json = EXCLUDED.claim_hashes_json,
      claim_count = EXCLUDED.claim_count,
      finalized_at = EXCLUDED.finalized_at,
      updated_at = EXCLUDED.updated_at
  `;
}

export async function getLatestSnapshot(fundId: string): Promise<SnapshotRow | undefined> {
  await initSchema();
  const db = sql();
  const rows = await db`
    SELECT *
    FROM snapshots
    WHERE fund_id = ${fundId}
    ORDER BY finalized_at DESC, id DESC
    LIMIT 1
  `;
  return rows[0] as unknown as SnapshotRow | undefined;
}

export async function getApprovedClaimHashesByFund(
  fundId: string
): Promise<Array<{ claimHash: string; epochId: bigint }>> {
  await initSchema();
  const db = sql();
  const rows = await db`
    SELECT c.claim_hash, c.epoch_id
    FROM claims c
    LEFT JOIN subject_state ss
      ON ss.subject_type = 'CLAIM' AND ss.subject_hash = c.claim_hash
    WHERE c.fund_id = ${fundId}
      AND COALESCE(ss.status, c.status) = 'APPROVED'
    ORDER BY CAST(c.epoch_id as BIGINT) ASC, c.claim_hash ASC
  `;

  return (rows as unknown as Array<{ claim_hash: string; epoch_id: string }>).map((row) => ({
    claimHash: row.claim_hash,
    epochId: BigInt(row.epoch_id)
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
  await initSchema();
  const db = sql();
  const now = nowMs();
  try {
    const rows = await db`
      INSERT INTO intents (
        fund_id, intent_hash, snapshot_hash, intent_uri, intent_json, execution_route_json,
        allowlist_hash, max_slippage_bps, max_notional, deadline,
        status, created_by, created_at, updated_at
      ) VALUES (
        ${input.fundId}, ${input.intentHash.toLowerCase()}, ${input.snapshotHash.toLowerCase()},
        ${input.intentUri}, ${input.intentJson}, ${input.executionRouteJson},
        ${input.allowlistHash.toLowerCase()}, ${input.maxSlippageBps.toString()},
        ${input.maxNotional.toString()}, ${input.deadline.toString()},
        'PENDING', ${input.createdBy}, ${now}, ${now}
      )
      RETURNING id
    `;
    return { ok: true, id: Number(rows[0].id) };
  } catch (error) {
    if (String(error).includes("duplicate key value")) {
      return { ok: false, reason: "DUPLICATE" };
    }
    throw error;
  }
}

export async function getIntentByHash(
  fundId: string,
  intentHash: string
): Promise<IntentRow | undefined> {
  await initSchema();
  const db = sql();
  const rows = await db`
    SELECT *
    FROM intents
    WHERE fund_id = ${fundId} AND intent_hash = ${intentHash.toLowerCase()}
    LIMIT 1
  `;
  return rows[0] as unknown as IntentRow | undefined;
}

export async function listExecutionJobs(input: {
  fundId?: string;
  status?: ExecutionJobStatus;
  limit: number;
  offset: number;
}) {
  await initSchema();
  const db = sql();

  const where: string[] = [];
  const params: Array<string | number> = [];
  let idx = 1;

  if (input.fundId) {
    where.push(`fund_id = $${idx++}`);
    params.push(input.fundId);
  }
  if (input.status) {
    where.push(`status = $${idx++}`);
    params.push(input.status);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  const rows = await db.unsafe(
    `
      SELECT *
      FROM execution_jobs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${idx++} OFFSET $${idx}
    `,
    [...params, input.limit, input.offset]
  );

  const totalRows = await db.unsafe(
    `
      SELECT COUNT(1) AS count
      FROM execution_jobs
      ${whereClause}
    `,
    params
  );

  return {
    rows: rows as unknown as ExecutionJobRow[],
    total: Number(totalRows[0]?.count ?? 0)
  };
}

export async function claimReadyExecutionJobs(
  limit: number
): Promise<ExecutionJobRow[]> {
  await initSchema();
  const db = sql();
  const now = nowMs();

  return db.begin(async (tx) => {
    const rows = await tx.unsafe(
      `
      SELECT *
      FROM execution_jobs
      WHERE status IN ('READY', 'FAILED_RETRYABLE') AND next_run_at <= $1
      ORDER BY created_at ASC
      LIMIT $2
      FOR UPDATE SKIP LOCKED
      `,
      [now, limit]
    );

    for (const row of rows as unknown as Array<{ id: number }>) {
      await tx.unsafe(
        `
        UPDATE execution_jobs
        SET status = 'RUNNING', updated_at = $1
        WHERE id = $2
        `,
        [now, row.id]
      );
    }

    return (rows as unknown as ExecutionJobRow[]).map((row) => ({
      ...row,
      status: "RUNNING"
    }));
  });
}

export async function markExecutionJobExecuted(id: number, txHash: string): Promise<void> {
  await initSchema();
  const db = sql();
  await db`
    UPDATE execution_jobs
    SET status = 'EXECUTED', tx_hash = ${txHash.toLowerCase()}, updated_at = ${nowMs()}
    WHERE id = ${id}
  `;
}

export async function markExecutionJobFailed(input: {
  id: number;
  attemptCount: number;
  retryDelayMs: number;
  maxAttempts: number;
  error: string;
}): Promise<void> {
  await initSchema();
  const db = sql();
  const now = nowMs();
  const final = input.attemptCount >= input.maxAttempts;
  await db`
    UPDATE execution_jobs
    SET status = ${final ? "FAILED_FINAL" : "FAILED_RETRYABLE"},
        attempt_count = ${input.attemptCount},
        next_run_at = ${now + input.retryDelayMs},
        last_error = ${input.error},
        updated_at = ${now}
    WHERE id = ${input.id}
  `;
}
