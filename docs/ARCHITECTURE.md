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
- claim ingestion and epoch state aggregation
- intent propose ingestion + executionRoute normalization
- intent attestation aggregation and onchain submit
- execution job queue + cron worker for `ClawCore.executeIntent`

Code:
- `packages/relayer/app/api/v1/**`
- `packages/relayer/lib/**`

### 2.3 Agents Runtime
- participant CLI: mine -> verify -> submit claim
- strategy helper: NadFun quote-based intent proposal decision

Code:
- `packages/agents/src/skills/participant/index.ts`
- `packages/agents/src/skills/strategy/index.ts`

### 2.4 Protocol SDK
Single source for canonical rules used by contracts tests, relayer, and agents.
- canonical hashing (`allocationClaimHash`, `intentHash`, `snapshotHash`)
- EIP-712 intent typed data and verification
- weighted threshold helpers (intent verifier set)
- execution-route allowlist hash

Code:
- `packages/sdk/src/**`

## 3. Data / Consensus Model
## 3.1 Claims (Current)
- Claims are stored in relayer DB (Supabase Postgres), not in the current onchain stack.
- Claim-level attestation/finalization is removed from primary flow.
- Participants submit `AllocationClaimV1`; strategy bot later aggregates epoch state.

## 3.2 Epoch State (Current)
- `POST /api/v1/funds/{fundId}/epochs/{epochId}/aggregate` computes epoch state from claims.
- `GET /api/v1/funds/{fundId}/epochs/latest` returns latest finalized epoch state.
- Epoch state hash is used as `TradeIntent.snapshotHash`.

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
- `POST /api/v1/funds/{fundId}/epochs/{epochId}/aggregate`
- `GET /api/v1/funds/{fundId}/epochs/latest`
- `POST /api/v1/funds/{fundId}/intents/propose`
- `POST /api/v1/funds/{fundId}/intents/attestations/batch`
- Removed (no-legacy): `POST /attestations`, `GET /snapshots/latest`, `GET /events/claims`

Ops:
- `GET /api/v1/funds/{fundId}/status`
- `GET /api/v1/metrics`
- `GET /api/v1/executions`
- `POST /api/v1/cron/execute-intents`
- SSE: `/events/intents`

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
- Strategy automation is BUY-heavy today; SELL is supported by protocol but not fully automated in strategy proposal path.
- Production hardening for retries/backoff/monitoring/alerting needs completion.

## 7. Operational Defaults
- Intent approval/finality is onchain through `IntentBook`.
- Final execution is relayer-executor initiated (`ClawCore.executeIntent`).
