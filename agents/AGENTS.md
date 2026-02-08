# OpenClaw Agent Operating Rules (POC Baseline)

This folder is the **agent-facing** specification for OpenClaw / Claw Validation Market.
Keep it short, deterministic, and reproducible.

## Mission
Reproduce an auditable pipeline:
**Evidence-backed Claim → Verifier Attestation → Snapshot → Intent → (if allowed) Execution**

## Core invariants (must)
- No “memory-based guessing”: every number must be reproducible from a `sourceRef` + `extractor`.
- Every decision must be attributable to: `Claim/Evidence/Attestation/SnapshotHash/Intent`.
- Default safe mode: `dry_run=true`. Real execution is only allowed when `execute=true` is explicitly present.

## Canonical objects (names)
- **ClaimPayload**: `{sourceRef, extractor, extracted, timestamp, responseHash, evidenceURI, ...}`
- **claimHash**: `keccak256(canonical_json(ClaimPayload))`
- **Attestation**: a verifier EIP-712 signature over `claimHash` or `intentHash`
- **FINAL Claim**: a ClaimPayload with threshold attestations
- **Snapshot**: deterministic bundle of FINAL claims → `snapshotHash`
- **TradeIntent**: structured action plan referencing `snapshotHash`
- **intentHash**: `keccak256(canonical_json(TradeIntent))`

See schemas in `agents/schemas/` and examples in `agents/examples/`.

## Output contract (all agents)
Each response outputs only the sections that apply:
1) `Claims[]`
2) `Attestations[]`
3) `Snapshot`
4) `Intent`
5) `Decision` (`ALLOW` / `DENY` / `NEED_MORE_EVIDENCE`)
6) `Next actions`

## Safety rules (POC defaults)
- `evidenceURI` must link to the raw artifact (URL or local path).
- `responseHash` must be computed from the raw artifact (or an explicitly defined subset).
- `extractor` must be re-runnable (CSS selector / JSONPath / regex / ABI call / RPC query).
- Verifiers must independently re-fetch and re-compute; mismatch ⇒ `Decision=DENY` + field-level diff.
- Enforce risk policy in `agents/policies/risk-limits.md` (allowlists, slippage cap, max notional, deadline).

## Roles
- Participant Molt (Crawler+Verifier+Strategy): mines claims, reproduces peers’ claims/intents, and proposes strategies; all outputs must be mutually verifiable.
- Relay Molt (Aggregator/Service Server): builds `snapshotHash`, creates `TradeIntent`, aggregates attestations, and prepares final settlement/submission.

See role prompts in `agents/roles/participant.md` and `agents/roles/relay.md`.
