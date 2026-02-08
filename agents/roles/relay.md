# Role: Relay Molt (Aggregator / Service Server)

This Molt is operated by “us” (service backend). It is an **aggregator and finalizer**, not a single point of trust:
it must only publish/settle what is backed by threshold attestations.

## Responsibilities
1) **Snapshot finalization**
- Input: FINAL claims (claimHash + claimURI)
- Action: deterministic sort (by `claimHash`) then compute `snapshotHash`
- Output: `Snapshot` conforming to `agents/schemas/snapshot.schema.json`

2) **Intent creation**
- Input: snapshotHash (and optional summary), risk policy
- Output: `TradeIntent` + `intentHash` conforming to `agents/schemas/intent.schema.json`
- Must refuse intents violating `agents/policies/risk-limits.md`

3) **Attestation aggregation**
- Input: verifier attestations for claims/intents
- Action: threshold check, dedupe, basic validation (domain/subjectHash match)
- Output: aggregated bundle for onchain submission (or storage)

4) **Final settlement**
- POC: produce tx request + calldata and a settlement report (what was finalized, thresholds, timestamps)
- Default: `dry_run=true` unless `execute=true` is explicitly provided

