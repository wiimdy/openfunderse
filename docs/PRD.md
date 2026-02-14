# Claw PRD (Current Delivery Baseline)

Last updated: 2026-02-14

## 1. Product Goal
Build a multi-agent fund operation loop where:
1. participant bots submit and verify claims,
2. strategy bot aggregates epoch state and proposes constrained intents,
3. relayer aggregates weighted intent attestations,
4. only approved intents are executed onchain under risk constraints.

## 2. Implemented Scope (Now)
### 2.1 Contracts
- Fund stack deployment via `ClawFundFactory`.
- Intent consensus via `IntentBook` (`proposeIntent`, `attestIntent`, approval state).
- Risk-gated execution via `ClawCore` + `ClawVault4626`.
- NadFun adapter path present (`NadfunExecutionAdapter`).

### 2.2 Relayer
- Supabase/Postgres persistence.
- Admin fund APIs (`/funds`, `/funds/bootstrap`).
- Strategy-only participant bot registration.
- Claim ingestion and epoch aggregation.
- Intent propose + intent attestation batch.
- Execution queue + cron endpoint + execution status APIs.
- Metrics and SSE event streams.

### 2.3 Agents / SDK / Openfunderse
- Participant CLI flow (mine/verify/submit/e2e).
- Strategy quote-based propose helper (currently BUY-first behavior).
- SDK is the canonical source for hashing, EIP-712, weighted threshold, execution route hash.
- Openfunderse distributes Codex skills/prompts; runtime remains in `packages/agents`.

## 3. Current E2E Operational Flow
1. Admin creates fund (`/api/v1/funds`) or deploys + persists (`/api/v1/funds/bootstrap`).
2. Strategy bot registers participant bots (`/bots/register`).
3. Crawler submits claim (`/claims`).
4. Strategy aggregates epoch state (`/epochs/{epochId}/aggregate`).
5. Latest epoch state is read (`/epochs/latest`).
7. Strategy proposes intent (`/intents/propose`) with required `executionRoute`.
8. Verifier submits intent attestation batch.
9. Relayer transitions intent to ready-for-onchain when threshold is met.
10. Execution worker runs (`/cron/execute-intents`) and calls `ClawCore.executeIntent` if preflight passes.
11. Operators observe `/executions`, `/status`, `/metrics`, SSE.

## 4. Constraints and Policy
- `intents/propose` does not allow direct `allowlistHash` input.
- Relayer computes and commits allowlist hash from `executionRoute`.
- Executor is relayer-managed (not permissionless yet).
- Legacy claim-attestation/snapshot endpoints are `410 GONE`.

## 5. Known Gaps / Not Yet Implemented
- Validator snapshot source is still env-backed, not onchain registry/snapshot source.
- Dry-run UX is contract-level available but not fully productized end-to-end in relayer API UX.
- Strategy automation has BUY bias; SELL is protocol-supported but not equally automated in propose logic.
- Production monitoring and automated incident handling are incomplete.

## 6. Definition of Done for Current Phase
A release is considered acceptable when:
- fund bootstrap/create works,
- participant claim e2e works,
- epoch aggregate + latest epoch state path works,
- intent propose + attest pipeline works,
- execution worker can settle approved intent onchain when signer has funds,
- status/metrics/executions APIs provide operator observability.
