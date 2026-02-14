# Claw Architecture (Current Implementation)

Last updated: 2026-02-14

## 1. Scope
This document describes the architecture currently implemented in this repository.
It is intentionally implementation-first, not future-ideal.

## 2. System Components
### 2.1 Onchain Contracts
- `ClawFundFactory`: deploys one fund stack per fund.
- `IntentBook`: strategy proposes intents, verifiers attest, threshold -> approved.
- `ClawCore`: validates approved intent constraints and executes via vault.
- `ClawVault4626`: asset custody, allowed tokens/adapters, trade execution.
- `NadfunExecutionAdapter`: NadFun buy/sell adapter.

Code:
- `packages/contracts/src/ClawFundFactory.sol`
- `packages/contracts/src/IntentBook.sol`
- `packages/contracts/src/ClawCore.sol`
- `packages/contracts/src/ClawVault4626.sol`
- `packages/contracts/src/adapters/NadfunExecutionAdapter.sol`

### 2.2 Offchain Relayer (Next.js)
Responsibilities:
- bot auth + role authz
- fund metadata + bot registry
- claim ingestion and claim attestation aggregation
- snapshot materialization from approved claims
- intent propose ingestion + executionRoute normalization
- intent attestation aggregation and onchain submit
- execution job queue + cron worker for `ClawCore.executeIntent`

Code:
- `packages/relayer/app/api/v1/**`
- `packages/relayer/lib/**`

### 2.3 Agents Runtime
- participant CLI: mine -> verify -> submit claim -> attest claim
- strategy helper: NadFun quote-based intent proposal decision

Code:
- `packages/agents/src/skills/participant/index.ts`
- `packages/agents/src/skills/strategy/index.ts`

### 2.4 Protocol SDK
Single source for canonical rules used by contracts tests, relayer, and agents.
- canonical hashing (`claimHash`, `intentHash`, `snapshotHash`)
- EIP-712 typed data and verification
- weighted threshold helpers
- execution-route allowlist hash

Code:
- `packages/sdk/src/**`

## 3. Data / Consensus Model
## 3.1 Claims (Current)
- Claims are stored in relayer DB (Supabase Postgres), not in the current onchain stack.
- Verifier attestation for claims is validated with EIP-712 in relayer.
- Threshold can finalize claim in relayer DB (`CLAIM_FINALIZATION_MODE=OFFCHAIN`, default).
- Optional compatibility mode exists for claim onchain attestation (`ONCHAIN`), but this is not the primary path for current contract stack.

## 3.2 Snapshots (Current)
- `GET /api/v1/funds/{fundId}/snapshots/latest` computes snapshot from approved claims.
- Snapshot is currently materialized in relayer DB.
- Validator snapshot for weighted checks is config-backed (`VERIFIER_WEIGHT_SNAPSHOT`) with TODO to replace by onchain registry/snapshot source.

## 3.3 Intents (Current)
- Strategy bot submits intent via `POST /intents/propose`.
- `executionRoute` is required; relayer computes `allowlistHash` server-side.
- Verifiers submit EIP-712 intent attestations.
- On threshold, relayer submits `IntentBook.attestIntent(...)` onchain.
- Approved intent creates execution job.

## 3.4 Execution (Current)
- Cron endpoint triggers worker: `POST /api/v1/cron/execute-intents`.
- Worker preflights with `ClawCore.validateIntentExecution`.
- If valid, worker calls `ClawCore.executeIntent` using relayer/executor signer.
- Execution status is tracked in `execution_jobs`.

## 4. API Surface (v1)
Admin:
- `POST /api/v1/funds`
- `POST /api/v1/funds/bootstrap`

Bots:
- `POST/GET /api/v1/funds/{fundId}/bots/register`
- `POST /api/v1/funds/{fundId}/claims`
- `GET /api/v1/funds/{fundId}/claims`
- `POST /api/v1/funds/{fundId}/attestations`
- `GET /api/v1/funds/{fundId}/snapshots/latest`
- `POST /api/v1/funds/{fundId}/intents/propose`
- `POST /api/v1/funds/{fundId}/intents/attestations/batch`

Ops:
- `GET /api/v1/funds/{fundId}/status`
- `GET /api/v1/metrics`
- `GET /api/v1/executions`
- `POST /api/v1/cron/execute-intents`
- SSE: `/events/claims`, `/events/intents`

## 5. Key Contract/Relayer Coupling Points
Any signature/ABI change here requires relayer update in lockstep:
- `IntentBook.getIntentExecutionData(...)`
- `IntentBook.attestIntent(...)`
- `ClawCore.validateIntentExecution(...)`
- `ClawCore.executeIntent(...)`

Relayer call sites:
- `packages/relayer/lib/onchain.ts`
- `packages/relayer/lib/executor.ts`

## 6. Current Gaps / TODO
- Replace config-backed validator snapshot with onchain source of truth.
- Dry-run and simulation UX across relayer + agent path needs productized endpoint/workflow.
- Claim onchain path should be either fully integrated into current stack or explicitly deprecated.
- Strategy automation is BUY-heavy today; SELL is supported by protocol but not fully automated in strategy proposal path.
- Production hardening for retries/backoff/monitoring/alerting needs completion.

## 7. Operational Defaults
- Recommended: `CLAIM_FINALIZATION_MODE=OFFCHAIN`
- Intent approval/finality is onchain through `IntentBook`.
- Final execution is relayer-executor initiated (`ClawCore.executeIntent`).
