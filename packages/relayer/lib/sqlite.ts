import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { relayerDbPath } from "@/lib/config";

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
  allowlist_hash: string;
  max_slippage_bps: string;
  max_notional: string;
  deadline: string;
  status: RecordStatus;
  created_by: string;
  created_at: number;
  updated_at: number;
}

let dbSingleton: Database.Database | null = null;

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS funds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fund_id TEXT NOT NULL UNIQUE,
      fund_name TEXT NOT NULL,
      strategy_bot_id TEXT NOT NULL DEFAULT '',
      strategy_bot_address TEXT NOT NULL DEFAULT '',
      verifier_threshold_weight TEXT NOT NULL,
      intent_threshold_weight TEXT NOT NULL,
      strategy_policy_uri TEXT,
      telegram_room_id TEXT,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fund_bots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fund_id TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      role TEXT NOT NULL,
      bot_address TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      policy_uri TEXT,
      telegram_handle TEXT,
      registered_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(fund_id, bot_id)
    );

    CREATE TABLE IF NOT EXISTS attestations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(subject_type, subject_hash, verifier)
    );

    CREATE TABLE IF NOT EXISTS subject_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(subject_type, subject_hash)
    );

    CREATE TABLE IF NOT EXISTS claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fund_id TEXT NOT NULL,
      claim_hash TEXT NOT NULL,
      epoch_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(fund_id, claim_hash)
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fund_id TEXT NOT NULL,
      epoch_id TEXT NOT NULL,
      snapshot_hash TEXT NOT NULL,
      claim_hashes_json TEXT NOT NULL,
      claim_count INTEGER NOT NULL,
      finalized_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(fund_id, epoch_id)
    );

    CREATE TABLE IF NOT EXISTS intents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fund_id TEXT NOT NULL,
      intent_hash TEXT NOT NULL,
      snapshot_hash TEXT NOT NULL,
      intent_uri TEXT,
      intent_json TEXT NOT NULL,
      allowlist_hash TEXT NOT NULL,
      max_slippage_bps TEXT NOT NULL,
      max_notional TEXT NOT NULL,
      deadline TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(fund_id, intent_hash)
    );

    CREATE INDEX IF NOT EXISTS idx_attestations_subject
      ON attestations(subject_type, subject_hash, status);

    CREATE INDEX IF NOT EXISTS idx_fund_bots_fund
      ON fund_bots(fund_id, status);

    CREATE INDEX IF NOT EXISTS idx_claims_fund_epoch
      ON claims(fund_id, epoch_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_snapshots_fund_finalized
      ON snapshots(fund_id, finalized_at DESC);

    CREATE INDEX IF NOT EXISTS idx_intents_fund_snapshot
      ON intents(fund_id, snapshot_hash, created_at DESC);
  `);

  // Backward-compatible migration for existing local DBs from count-threshold schema.
  const columns = db
    .prepare(`PRAGMA table_info(subject_state)`)
    .all() as Array<{ name: string }>;
  const names = new Set(columns.map((c) => c.name));

  if (!names.has("threshold_weight")) {
    db.exec(`ALTER TABLE subject_state ADD COLUMN threshold_weight TEXT NOT NULL DEFAULT '0';`);
  }
  if (!names.has("attested_weight")) {
    db.exec(`ALTER TABLE subject_state ADD COLUMN attested_weight TEXT NOT NULL DEFAULT '0';`);
  }

  if (names.has("threshold_count")) {
    db.exec(`
      UPDATE subject_state
      SET threshold_weight = CAST(threshold_count AS TEXT)
      WHERE threshold_weight = '0';
    `);
  }
  if (names.has("valid_count")) {
    db.exec(`
      UPDATE subject_state
      SET attested_weight = CAST(valid_count AS TEXT)
      WHERE attested_weight = '0';
    `);
  }

  const fundColumns = db
    .prepare(`PRAGMA table_info(funds)`)
    .all() as Array<{ name: string }>;
  const fundNames = new Set(fundColumns.map((c) => c.name));
  if (!fundNames.has("strategy_bot_id")) {
    db.exec(`ALTER TABLE funds ADD COLUMN strategy_bot_id TEXT NOT NULL DEFAULT '';`);
  }
  if (!fundNames.has("strategy_bot_address")) {
    db.exec(`ALTER TABLE funds ADD COLUMN strategy_bot_address TEXT NOT NULL DEFAULT '';`);
  }
}

export function upsertFund(input: {
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
  const db = getDb();
  const now = Date.now();

  db.prepare(`
    INSERT INTO funds (
      fund_id, fund_name, strategy_bot_id, strategy_bot_address, verifier_threshold_weight, intent_threshold_weight,
      strategy_policy_uri, telegram_room_id, created_by,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(fund_id) DO UPDATE SET
      fund_name=excluded.fund_name,
      strategy_bot_id=excluded.strategy_bot_id,
      strategy_bot_address=excluded.strategy_bot_address,
      verifier_threshold_weight=excluded.verifier_threshold_weight,
      intent_threshold_weight=excluded.intent_threshold_weight,
      strategy_policy_uri=excluded.strategy_policy_uri,
      telegram_room_id=excluded.telegram_room_id,
      updated_at=excluded.updated_at
  `).run(
    input.fundId,
    input.fundName,
    input.strategyBotId,
    input.strategyBotAddress,
    input.verifierThresholdWeight.toString(),
    input.intentThresholdWeight.toString(),
    input.strategyPolicyUri,
    input.telegramRoomId,
    input.createdBy,
    now,
    now
  );
}

export function getFund(fundId: string) {
  const db = getDb();
  return db
    .prepare(
      `
      SELECT
        fund_id, fund_name, strategy_bot_id, strategy_bot_address, verifier_threshold_weight, intent_threshold_weight,
        strategy_policy_uri, telegram_room_id, created_by, created_at, updated_at
      FROM funds
      WHERE fund_id = ?
      LIMIT 1
    `
    )
    .get(fundId) as
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

export function getFundThresholds(fundId: string):
  | { claimThresholdWeight: bigint; intentThresholdWeight: bigint }
  | null {
  const fund = getFund(fundId);
  if (!fund) return null;

  return {
    claimThresholdWeight: BigInt(fund.verifier_threshold_weight),
    intentThresholdWeight: BigInt(fund.intent_threshold_weight)
  };
}

export function upsertFundBot(input: {
  fundId: string;
  botId: string;
  role: string;
  botAddress: string;
  status: "ACTIVE" | "DISABLED";
  policyUri: string | null;
  telegramHandle: string | null;
  registeredBy: string;
}) {
  const db = getDb();
  const now = Date.now();

  db.prepare(`
    INSERT INTO fund_bots (
      fund_id, bot_id, role, bot_address, status,
      policy_uri, telegram_handle, registered_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(fund_id, bot_id) DO UPDATE SET
      role=excluded.role,
      bot_address=excluded.bot_address,
      status=excluded.status,
      policy_uri=excluded.policy_uri,
      telegram_handle=excluded.telegram_handle,
      registered_by=excluded.registered_by,
      updated_at=excluded.updated_at
  `).run(
    input.fundId,
    input.botId,
    input.role,
    input.botAddress,
    input.status,
    input.policyUri,
    input.telegramHandle,
    input.registeredBy,
    now,
    now
  );
}

export function listFundBots(fundId: string) {
  const db = getDb();
  return db
    .prepare(
      `
      SELECT
        fund_id, bot_id, role, bot_address, status,
        policy_uri, telegram_handle, registered_by, created_at, updated_at
      FROM fund_bots
      WHERE fund_id = ?
      ORDER BY created_at ASC
    `
    )
    .all(fundId) as Array<{
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

export function getDb(): Database.Database {
  if (dbSingleton) return dbSingleton;

  const dbPath = relayerDbPath();
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });

  dbSingleton = new Database(dbPath);
  initSchema(dbSingleton);
  return dbSingleton;
}

export function insertAttestation(input: {
  fundId: string;
  subjectType: SubjectType;
  subjectHash: string;
  epochId: bigint | null;
  verifier: string;
  expiresAt: bigint;
  nonce: bigint;
  signature: string;
}): { ok: true; id: number } | { ok: false; reason: "DUPLICATE" } {
  const db = getDb();
  const now = Date.now();

  const stmt = db.prepare(`
    INSERT INTO attestations (
      fund_id, subject_type, subject_hash, epoch_id,
      verifier, expires_at, nonce, signature,
      status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
  `);

  try {
    const result = stmt.run(
      input.fundId,
      input.subjectType,
      input.subjectHash,
      input.epochId === null ? null : input.epochId.toString(),
      input.verifier.toLowerCase(),
      input.expiresAt.toString(),
      input.nonce.toString(),
      input.signature,
      now,
      now
    );

    return { ok: true, id: Number(result.lastInsertRowid) };
  } catch (error) {
    const message = String(error);
    if (message.includes("UNIQUE constraint failed")) {
      return { ok: false, reason: "DUPLICATE" };
    }
    throw error;
  }
}

export function upsertSubjectState(input: {
  fundId: string;
  subjectType: SubjectType;
  subjectHash: string;
  epochId: bigint | null;
  thresholdWeight: bigint;
}): void {
  const db = getDb();
  const now = Date.now();

  db.prepare(`
    INSERT INTO subject_state (
      fund_id, subject_type, subject_hash, epoch_id,
      threshold_weight, attested_weight, status,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, '0', 'PENDING', ?, ?)
    ON CONFLICT(subject_type, subject_hash) DO UPDATE SET
      threshold_weight=excluded.threshold_weight,
      updated_at=excluded.updated_at
  `).run(
    input.fundId,
    input.subjectType,
    input.subjectHash,
    input.epochId === null ? null : input.epochId.toString(),
    input.thresholdWeight.toString(),
    now,
    now
  );
}

export function incrementSubjectAttestedWeight(
  subjectType: SubjectType,
  subjectHash: string,
  delta: bigint
): bigint {
  if (delta < BigInt(0)) {
    throw new Error("delta must be non-negative");
  }
  const db = getDb();

  const row = db
    .prepare(`SELECT attested_weight FROM subject_state WHERE subject_type = ? AND subject_hash = ?`)
    .get(subjectType, subjectHash) as { attested_weight: string } | undefined;

  const prev = row ? BigInt(row.attested_weight) : BigInt(0);
  const next = prev + delta;

  db.prepare(`
    UPDATE subject_state
    SET attested_weight = ?,
        updated_at = ?
    WHERE subject_type = ? AND subject_hash = ?
  `).run(next.toString(), Date.now(), subjectType, subjectHash);

  return next;
}

export function getSubjectState(subjectType: SubjectType, subjectHash: string) {
  const db = getDb();
  return db
    .prepare(`
      SELECT * FROM subject_state
      WHERE subject_type = ? AND subject_hash = ?
      LIMIT 1
    `)
    .get(subjectType, subjectHash) as
    | {
        threshold_weight: string;
        attested_weight: string;
        status: RecordStatus;
        submit_attempts: number;
      }
    | undefined;
}

export function listPendingAttestations(subjectType: SubjectType, subjectHash: string): AttestationRow[] {
  const db = getDb();
  return db
    .prepare(`
      SELECT * FROM attestations
      WHERE subject_type = ? AND subject_hash = ? AND status = 'PENDING'
      ORDER BY created_at ASC
    `)
    .all(subjectType, subjectHash) as AttestationRow[];
}

export function markSubjectApproved(input: {
  subjectType: SubjectType;
  subjectHash: string;
  txHash: string;
}): void {
  const db = getDb();
  const now = Date.now();

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE subject_state
      SET status = 'APPROVED', tx_hash = ?, updated_at = ?
      WHERE subject_type = ? AND subject_hash = ?
    `).run(input.txHash, now, input.subjectType, input.subjectHash);

    db.prepare(`
      UPDATE attestations
      SET status = 'APPROVED', tx_hash = ?, updated_at = ?
      WHERE subject_type = ? AND subject_hash = ? AND status = 'PENDING'
    `).run(input.txHash, now, input.subjectType, input.subjectHash);

    if (input.subjectType === "CLAIM") {
      db.prepare(`
        UPDATE claims
        SET status = 'APPROVED', updated_at = ?
        WHERE claim_hash = ?
      `).run(now, input.subjectHash.toLowerCase());
    } else {
      db.prepare(`
        UPDATE intents
        SET status = 'APPROVED', updated_at = ?
        WHERE intent_hash = ?
      `).run(now, input.subjectHash.toLowerCase());
    }
  });

  tx();
}

export function markSubjectSubmitError(input: {
  subjectType: SubjectType;
  subjectHash: string;
  message: string;
}): void {
  const db = getDb();

  db.prepare(`
    UPDATE subject_state
    SET submit_attempts = submit_attempts + 1,
        last_error = ?,
        updated_at = ?
    WHERE subject_type = ? AND subject_hash = ?
  `).run(input.message, Date.now(), input.subjectType, input.subjectHash);
}

export function getStatusSummary(fundId: string) {
  const db = getDb();

  const claim = db
    .prepare(`
      SELECT
        SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) AS approved
      FROM subject_state
      WHERE fund_id = ? AND subject_type = 'CLAIM'
    `)
    .get(fundId) as { pending: number | null; approved: number | null };

  const intent = db
    .prepare(`
      SELECT
        SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) AS approved
      FROM subject_state
      WHERE fund_id = ? AND subject_type = 'INTENT'
    `)
    .get(fundId) as { pending: number | null; approved: number | null };

  const rows = db
    .prepare(
      `
      SELECT subject_type, status, threshold_weight, attested_weight
      FROM subject_state
      WHERE fund_id = ?
    `
    )
    .all(fundId) as Array<{
    subject_type: SubjectType;
    status: RecordStatus;
    threshold_weight: string;
    attested_weight: string;
  }>;

  let claimAttestedWeight = BigInt(0);
  let claimThresholdWeight = BigInt(0);
  let intentAttestedWeight = BigInt(0);
  let intentThresholdWeight = BigInt(0);

  for (const row of rows) {
    if (row.subject_type === "CLAIM") {
      claimAttestedWeight += BigInt(row.attested_weight);
      claimThresholdWeight += BigInt(row.threshold_weight);
      continue;
    }

    intentAttestedWeight += BigInt(row.attested_weight);
    intentThresholdWeight += BigInt(row.threshold_weight);
  }

  return {
    claims: {
      pending: claim.pending ?? 0,
      approved: claim.approved ?? 0,
      attestedWeight: claimAttestedWeight.toString(),
      thresholdWeight: claimThresholdWeight.toString()
    },
    intents: {
      pending: intent.pending ?? 0,
      approved: intent.approved ?? 0,
      attestedWeight: intentAttestedWeight.toString(),
      thresholdWeight: intentThresholdWeight.toString()
    }
  };
}

export function insertClaim(input: {
  fundId: string;
  claimHash: string;
  epochId: bigint;
  payloadJson: string;
  createdBy: string;
}): { ok: true; id: number } | { ok: false; reason: "DUPLICATE" } {
  const db = getDb();
  const now = Date.now();
  try {
    const result = db
      .prepare(
        `
      INSERT INTO claims (
        fund_id, claim_hash, epoch_id, payload_json, status, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?)
    `
      )
      .run(
        input.fundId,
        input.claimHash.toLowerCase(),
        input.epochId.toString(),
        input.payloadJson,
        input.createdBy,
        now,
        now
      );

    return { ok: true, id: Number(result.lastInsertRowid) };
  } catch (error) {
    const message = String(error);
    if (message.includes("UNIQUE constraint failed")) {
      return { ok: false, reason: "DUPLICATE" };
    }
    throw error;
  }
}

export function listClaimsByFund(input: {
  fundId: string;
  status?: RecordStatus;
  epochId?: bigint;
  limit: number;
  offset: number;
}) {
  const db = getDb();
  const where = ["c.fund_id = @fundId"];
  const params: Record<string, unknown> = {
    fundId: input.fundId,
    limit: input.limit,
    offset: input.offset
  };

  if (input.status) {
    where.push("COALESCE(ss.status, c.status) = @status");
    params.status = input.status;
  }
  if (input.epochId !== undefined) {
    where.push("c.epoch_id = @epochId");
    params.epochId = input.epochId.toString();
  }

  const whereClause = where.join(" AND ");

  const rows = db
    .prepare(
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
      LIMIT @limit OFFSET @offset
    `
    )
    .all(params) as Array<{
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
  }>;

  const total = db
    .prepare(
      `
      SELECT COUNT(1) AS count
      FROM claims c
      LEFT JOIN subject_state ss
        ON ss.subject_type = 'CLAIM' AND ss.subject_hash = c.claim_hash
      WHERE ${whereClause}
    `
    )
    .get(params) as { count: number };

  return { rows, total: total.count };
}

export function upsertSnapshot(input: {
  fundId: string;
  epochId: bigint;
  snapshotHash: string;
  claimHashes: string[];
}): void {
  const db = getDb();
  const now = Date.now();
  db.prepare(
    `
    INSERT INTO snapshots (
      fund_id, epoch_id, snapshot_hash, claim_hashes_json, claim_count, finalized_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(fund_id, epoch_id) DO UPDATE SET
      snapshot_hash = excluded.snapshot_hash,
      claim_hashes_json = excluded.claim_hashes_json,
      claim_count = excluded.claim_count,
      finalized_at = excluded.finalized_at,
      updated_at = excluded.updated_at
  `
  ).run(
    input.fundId,
    input.epochId.toString(),
    input.snapshotHash.toLowerCase(),
    JSON.stringify(input.claimHashes.map((h) => h.toLowerCase())),
    input.claimHashes.length,
    now,
    now,
    now
  );
}

export function getLatestSnapshot(fundId: string): SnapshotRow | undefined {
  const db = getDb();
  return db
    .prepare(
      `
      SELECT *
      FROM snapshots
      WHERE fund_id = ?
      ORDER BY finalized_at DESC, id DESC
      LIMIT 1
    `
    )
    .get(fundId) as SnapshotRow | undefined;
}

export function getApprovedClaimHashesByFund(fundId: string): Array<{ claimHash: string; epochId: bigint }> {
  const db = getDb();
  const rows = db
    .prepare(
      `
      SELECT c.claim_hash, c.epoch_id
      FROM claims c
      LEFT JOIN subject_state ss
        ON ss.subject_type = 'CLAIM' AND ss.subject_hash = c.claim_hash
      WHERE c.fund_id = ?
        AND COALESCE(ss.status, c.status) = 'APPROVED'
      ORDER BY CAST(c.epoch_id as INTEGER) ASC, c.claim_hash ASC
    `
    )
    .all(fundId) as Array<{ claim_hash: string; epoch_id: string }>;

  return rows.map((row) => ({
    claimHash: row.claim_hash as `0x${string}`,
    epochId: BigInt(row.epoch_id)
  }));
}

export function insertIntent(input: {
  fundId: string;
  intentHash: string;
  snapshotHash: string;
  intentUri: string | null;
  intentJson: string;
  allowlistHash: string;
  maxSlippageBps: bigint;
  maxNotional: bigint;
  deadline: bigint;
  createdBy: string;
}): { ok: true; id: number } | { ok: false; reason: "DUPLICATE" } {
  const db = getDb();
  const now = Date.now();
  try {
    const result = db
      .prepare(
        `
      INSERT INTO intents (
        fund_id, intent_hash, snapshot_hash, intent_uri, intent_json,
        allowlist_hash, max_slippage_bps, max_notional, deadline,
        status, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)
    `
      )
      .run(
        input.fundId,
        input.intentHash.toLowerCase(),
        input.snapshotHash.toLowerCase(),
        input.intentUri,
        input.intentJson,
        input.allowlistHash.toLowerCase(),
        input.maxSlippageBps.toString(),
        input.maxNotional.toString(),
        input.deadline.toString(),
        input.createdBy,
        now,
        now
      );
    return { ok: true, id: Number(result.lastInsertRowid) };
  } catch (error) {
    const message = String(error);
    if (message.includes("UNIQUE constraint failed")) {
      return { ok: false, reason: "DUPLICATE" };
    }
    throw error;
  }
}
