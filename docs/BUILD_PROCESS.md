# Build Process (Hackathon-Oriented)

This is a pragmatic, repeatable process to go from idea -> working demo -> submission.

## 1. Clarify the MVP (1-2 hours)
- Decide the single "hero loop" you must demo:
  - Claim -> Attest -> Snapshot -> Intent -> Attest -> Execute
- Lock a tiny scope:
  - 1 vault asset, 1-2 tradable tokens, 1 venue (prefer a demo AMM), 1 claim schema.
- Write down:
  - thresholds (claimThreshold, intentThreshold)
  - risk limits (maxTrade, slippage cap, cooldown)
  - success metric for the demo (e.g., 3 claims -> 1 trade executed)

Deliverable:
- A one-page spec (can be the PRD summary).

## 2. Protocol Spec (half-day)
Before coding, define the exact bytes that get signed and verified.
- Canonical hashing for `claimHash` and `intentHash`
- EIP-712 domain separator
- Nonce/expiry rules
- Snapshot hashing rules (ordering!)

Deliverable:
- A short "spec.md" section (can be embedded in ARCHITECTURE.md).

## 3. Threat Model (2-4 hours)
You do not need a full audit, but you do need to avoid obvious footguns.
Answer:
- What can a malicious relayer do?
- What can a malicious verifier do?
- What happens if the strategy agent is wrong?
- How do we fail safely?

Deliverable:
- A threat checklist with mitigations (pause, allowlists, thresholds, caps, expiries).

## 4. Contracts First (2-3 days)
Order of implementation:
1) `ClaimBook`: submitClaim + attestClaim + finalized state + snapshot hashing
2) `IntentBook`: proposeIntent + attestIntent + approved state
3) `ClawVault`: executeIntent with risk checks + token/venue integration
4) (optional) points/reputation

Testing:
- Unit tests for:
  - signature verification
  - threshold counting and uniqueness
  - snapshotHash determinism
  - vault risk rules (minOut, deadline, allowlist)
- Invariant tests (nice-to-have):
  - "cannot execute without approval"
  - "cannot exceed caps"

Deliverable:
- Deployed contracts + a script that runs the full loop locally.

## 5. Agents + Relayer (2-4 days)
Implement offchain components in the simplest possible way:
- Crawler agent:
  - fetch -> extract -> write claim JSON -> submit claimHash
- Verifier agent:
  - read claimURI -> re-crawl -> if match sign claimHash
  - read intentURI -> check risk constraints -> sign intentHash
- Relayer:
  - collect signatures from a few verifiers and submit batch txs

Key design choice for MVP:
- Make the system work with 3-5 verifier keys you control (not permissionless yet).

Deliverable:
- `make demo` script that:
  - posts 3 claims
  - collects attestations
  - finalizes snapshot
  - proposes intent
  - collects intent attestations
  - executes trade

## 6. UI + Indexing (2-3 days)
Do not build a complex UI. Build a "proof dashboard":
- Claims table (status, attestation count)
- Intents table (approved or not)
- Vault balances and last execution
- Leaderboard (points)

Indexing options:
- Quick: parse onchain events with a script and serve JSON.
- Better: small indexer + SQLite.

Deliverable:
- A stable demo UI that never flakes.

## 7. Demo & Submission Package (1-2 days)
Hackathon outcomes depend on clarity.
- 2-minute script:
  - show claim evidence -> show approvals -> show execution tx -> show balances
- A short README with:
  - problem, approach, architecture diagram, how to run
- A short video if required

Deliverable:
- "press play" experience for judges.

## 8. What To Add (After MVP, if time)
Pick only 1-2.
- zkTLS evidence type for 1 source (strong wow-factor)
- stake + slashing (even a simple dispute window)
- weighted thresholds by reputation
- multiple relayers (permissionless submissions)
- intent simulation (quote check) before execution
- private execution / MEV mitigation
- nad.fun token launch + points -> token conversion

## 9. Common Missing Pieces (Teams forget these)
- Canonical encoding mismatch bugs (hash differs across components)
- Nonce management / signature replay
- Ordering of claimHashes in snapshot
- Slippage/minOut not enforced everywhere
- "Paused" path and emergency recovery
- A deterministic demo venue (DEX integration breaks demos)

