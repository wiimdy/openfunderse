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

    CREATE INDEX IF NOT EXISTS idx_attestations_subject
      ON attestations(subject_type, subject_hash, status);

    CREATE INDEX IF NOT EXISTS idx_fund_bots_fund
      ON fund_bots(fund_id, status);
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
