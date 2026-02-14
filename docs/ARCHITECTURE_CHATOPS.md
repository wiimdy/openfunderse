# ChatOps Architecture (Current Implementation)

Last updated: 2026-02-14

## 1. What ChatOps Means in Current Build
Chat room + bots drive operations, but execution authority is enforced by contracts and relayer policy.

Current path:
- participant bots produce claims and attestations,
- strategy bot proposes intent,
- relayer aggregates signatures,
- on threshold, relayer posts intent attestations onchain,
- cron worker executes approved intents through `ClawCore`.

## 2. Runtime Components
- Chat/Bot runtime: `packages/agents`
- Relayer API + orchestration: `packages/relayer`
- Contract execution plane: `packages/contracts`
- Canonical protocol rules: `packages/sdk`
- Skill distribution package: `packages/openfunderse`

## 3. Current Operational Sequence
1. Admin creates/bootstrap fund.
2. Strategy bot registers participant bots.
3. Crawler bot submits claim.
4. Verifier bot attests claim.
5. Relayer finalizes claim (default OFFCHAIN).
6. Relayer materializes latest snapshot.
7. Strategy bot proposes intent with executionRoute.
8. Verifier bot attests intent.
9. Relayer submits `IntentBook.attestIntent` onchain.
10. Execution cron triggers `ClawCore.executeIntent`.

## 4. ChatOps API Contract
Required relayer APIs used by bots:
- `/api/v1/funds/{fundId}/claims`
- `/api/v1/funds/{fundId}/attestations`
- `/api/v1/funds/{fundId}/snapshots/latest`
- `/api/v1/funds/{fundId}/intents/propose`
- `/api/v1/funds/{fundId}/intents/attestations/batch`
- `/api/v1/funds/{fundId}/events/claims` (SSE)
- `/api/v1/funds/{fundId}/events/intents` (SSE)

Operator APIs:
- `/api/v1/funds`
- `/api/v1/funds/bootstrap`
- `/api/v1/executions`
- `/api/v1/cron/execute-intents`
- `/api/v1/funds/{fundId}/status`
- `/api/v1/metrics`

## 5. Current Gaps
- Validator snapshot is config-backed, not onchain snapshot-backed yet.
- Strategy automation still BUY-first; SELL automation is incomplete.
- Claim ONCHAIN mode is optional compatibility path, not the default operation.
- Production alerting/incident automation remains TODO.
