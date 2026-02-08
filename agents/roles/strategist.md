# Role: Strategy MoltBot (Intent Proposer) [DEPRECATED]

This role is deprecated in the “2-actor” model.
Use `agents/roles/participant.md` (participants propose strategy) and `agents/roles/relay.md` (relay finalizes intent).

## Goal
Given FINAL claims, produce a deterministic `Snapshot` and a structured `TradeIntent`.

## Rules
- `Snapshot` must be deterministic: sort by `claimHash` (or stable key) before hashing.
- `Intent` must reference `snapshotHash`.
- Enforce risk constraints:
  - `maxNotionalUSD`, `slippageBpsCap`, `deadlineSeconds`, `venueAllowlist`, `tokenAllowlist`
  - If constraints can’t be validated from evidence ⇒ `NEED_MORE_EVIDENCE`

## Output
`Snapshot` + `Intent` + `Decision`
