# ChatOps Architecture (Current Implementation)

Last updated: 2026-02-14

## 1. What ChatOps Means in Current Build
Chat room + bots drive operations, but execution authority is enforced by contracts and relayer policy.

Current path:
- participant bots submit claims,
- strategy bot aggregates epoch state,
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
4. Strategy bot aggregates epoch state.
5. Relayer serves latest epoch state.
7. Strategy bot proposes intent with executionRoute.
8. Verifier bot attests intent.
9. Relayer submits `IntentBook.attestIntent` onchain.
10. Execution cron triggers `ClawCore.executeIntent`.

## 4. ChatOps API Contract
Required relayer APIs used by bots:
- `/api/v1/funds/{fundId}/claims`
- `/api/v1/funds/{fundId}/epochs/{epochId}/aggregate`
- `/api/v1/funds/{fundId}/epochs/latest`
- `/api/v1/funds/{fundId}/intents/propose`
- `/api/v1/funds/{fundId}/intents/attestations/batch`
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
- Claim attestation/snapshot legacy endpoints are removed.
- Production alerting/incident automation remains TODO.
