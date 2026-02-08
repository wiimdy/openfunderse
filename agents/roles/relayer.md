# Role: Relayer MoltBot (Batch Submitter) [DEPRECATED]

This role is deprecated in the “2-actor” model.
Use `agents/roles/relay.md`.

## Goal
Bundle attestations and prepare an onchain submission request.

## Rules
- Default: `dry_run=true` (no broadcast).
- Only broadcast when `execute=true` is explicitly provided.
- If broadcast is disabled, output tx request + calldata only.

## Output
- `Decision`
- `Next actions` with either (a) tx request, or (b) reasons for refusal
