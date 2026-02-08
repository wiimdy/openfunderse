# Claw: Verified Data Swarm Vault (Monad) - PRD

## 1. Summary
Claw is an onchain vault that executes trades only when a swarm of independent agents (verifiers) attest to:
1) the validity of data claims mined from specific sources (evidence-backed), and
2) the safety/consistency of a proposed trade intent derived from those validated claims.

The product demonstrates "agents that can transact at scale" by turning agent-to-agent coordination into enforced onchain execution and automated rewards.

## 2. Problem
Agentic trading prototypes usually fail on trust:
- Data inputs are unverifiable (prompt injection / cherry-picked evidence).
- One operator controls execution (centralized relayer risk).
- No transparent accountability (who said what, and who gets paid/slashed).

We need a structure where:
- Data provenance is auditable.
- Decisions are gated by multi-party validation.
- Execution is onchain and constrained by risk rules.
- Contributors are rewarded for correct work (and optionally penalized for bad work).

## 3. Goals (Hackathon MVP)
- Evidence-backed data claims: store a commitment onchain, keep heavy evidence offchain.
- Multi-agent validation: gather N-of-M unique attestations (optionally weighted).
- Prompt-to-intent pipeline: validated dataset snapshot -> strategy output -> structured trade intent.
- Onchain execution: vault executes the intent only after intent-attestation threshold is met.
- Transparent incentives: points/rewards for miners and verifiers; a clear leaderboard.
- A demo that is "weird + works": show the full loop end-to-end in <2 minutes.

## 4. Non-Goals (MVP)
- Real-money fund operations (treat as demo / test funds; no financial advice).
- Full trustless web proofs for all sources (zkTLS optional in MVP).
- Complex portfolio mgmt, leverage, cross-chain, or high-frequency strategies.
- Fully generalized ERC-8004 compliance (we can be "ERC-8004-inspired" and map to it later).

## 5. Users / Personas
- LP (Depositor): deposits into the vault, wants transparency and safety.
- Participant (Participant Molt Operator): mines claims, verifies peer claims/intents, and proposes strategy ideas; earns rewards.
- Relay (Relay Molt / Service Operator): aggregates attestations, finalizes snapshots/intents, and posts onchain submissions (POC: our service).

## 6. Core Concept: Claim -> Attest -> Snapshot -> Intent -> Attest -> Execute
Definitions:
- Claim: "From source S, at time T, selector X yields value V" + evidence pointer.
- Claim validation: verifiers attest to a claimHash after re-crawling or checking proof.
- Snapshot: a deterministic set of finalized claimHashes for an epoch, summarized by snapshotHash.
- Trade intent: a structured order (tokenIn/tokenOut/amount/minOut/deadline/constraints) referencing snapshotHash.
- Intent validation: verifiers sign intentHash; vault executes if threshold met.

## 7. Product Flow (MVP)
### 7.1 Epoch loop
1) Participant Molt publishes ClaimPayload to offchain storage, then calls onchain `submitClaim(claimHash, claimURI, meta)`.
2) Participant Molts evaluate the claim:
   - Option A (MVP): re-crawl and compare extracted value; sign if consistent.
   - Option B (optional): verify zkTLS proof; sign if valid.
3) Relay Molt aggregates verifier signatures and calls `attestClaim(claimHash, sigs)`.
4) When claim attestation threshold is met, the claim becomes "FINAL".
5) At epoch end, a snapshot is created: `finalizeSnapshot(epochId, claimHashes[])` -> snapshotHash.
6) Participants propose strategy ideas offchain; Relay Molt generates a TradeIntent (structured JSON) referencing the snapshot and posts to chain `proposeIntent(intentHash, intentURI, snapshotHash, constraints)`.
7) Participant Molts evaluate the intent (risk checks + consistency) and sign intentHash.
8) Relay Molt calls `attestIntent(intentHash, sigs)`.
9) Vault calls `executeIntent(intent)` only if intent is approved and within onchain risk limits.

### 7.2 UI / demo
- Show:
  - claim list (source, value, time), attestation progress
  - snapshot creation
  - proposed intent (human-readable) and approval progress
  - executed trade tx hash + vault balances
  - leaderboard for miners/verifiers

## 8. Functional Requirements
### 8.1 Claims
- Allow submission of claim commitments:
  - inputs: `claimHash`, `claimURI`, `sourceType`, `sourceRef`, `timestamp`, `schemaId`
  - store: minimal metadata + status + attestation count
- Support multiple claim schemas (MVP ships with 1-2 schemas).

### 8.2 Attestations (Claims + Intents)
- Only registered agents may attest (MVP: allowlist or simple registry).
- Enforce uniqueness: one attestation per agent per claim/intent.
- Threshold policies:
  - claimThreshold: e.g., 3 verifiers
  - intentThreshold: e.g., 5 verifiers
  - (optional) weighted by stake/reputation later

### 8.3 Snapshots
- Deterministically compute snapshotHash from ordered claimHashes and epochId.
- Freeze snapshot once finalized.

### 8.4 Intents
- TradeIntent includes:
  - `action` (BUY/SELL)
  - `tokenIn`, `tokenOut`
  - `amountIn` or `pctOfVault`
  - `minAmountOut`
  - `deadline`
  - `snapshotHash`
  - `maxSlippageBps`
  - `reasonHash` (hash of strategy explanation; full text in intentURI)

### 8.5 Vault execution
- Deposit/withdraw by LPs (MVP: single asset deposit like USDC mock).
- Execute only if:
  - intent is approved
  - deadline not expired
  - token/router allowlist passes
  - trade size within caps
  - minOut enforced
  - cooldown and daily limits ok
- Emit events for indexing and demo clarity.

### 8.6 Rewards / Points (MVP)
- Points ledger:
  - miners get points when their claims become FINAL
  - verifiers get points per correct attestation (MVP correctness = "attested to a FINAL claim/intent")
- (Optional) small token emission or vault fee split can be added, but points + leaderboard is enough for MVP.

## 9. Non-Functional Requirements
- Security:
  - no single relayer can force a trade (threshold signatures required)
  - pausable contracts (guardian)
  - reentrancy protection, safe ERC20 transfers
  - strict allowlists for tokens/routers in MVP
- Transparency:
  - every claim/intent has a hash and URI; all approvals are onchain
- Performance:
  - avoid storing large blobs onchain; store hashes + URIs
- Reliability:
  - if verification liveness fails, vault does nothing (safe failure mode)

## 10. MVP Scope (Recommended)
- One chain: Monad testnet/devnet.
- One quote asset: mock USDC (or chain native stable).
- One target memecoin: a demo token or a known testnet asset.
- One venue:
  - Option A: a minimal AMM we deploy for deterministic demos.
  - Option B: integrate a DEX router if available and stable.
- One claim schema:
  - "Social momentum score" computed from 2-3 sources (e.g., website counters).
  - Keep sources simple and stable to avoid demo flakiness.
- Verification:
  - MVP uses re-crawl consensus by verifiers.
  - zkTLS is "optional enhancement".

## 11. Risks & Mitigations
- Sybil verifiers:
  - MVP: allowlist verifiers; later: stake + reputation weighting + identity proofs.
- Data poisoning / selective reporting:
  - require multiple independent verifiers + public evidence URI
  - multiple sources per score
- MEV / sandwich:
  - use minOut + tight slippage + small sizes; consider private tx later
- Relay Molt censorship:
  - POC: our relay can be a bottleneck; mitigation is allowing alternative relays to submit aggregated sigs.
- Strategy mistakes:
  - keep strategy trivial; onchain risk caps; require higher intentThreshold

## 12. Milestones (2 weeks)
- Day 1-2: finalize schemas and thresholds; scaffold contracts; local e2e happy path.
- Day 3-5: relay aggregator + signature collection; indexer script.
- Day 6-8: participant molts (crawl/verify); claim generation and attestation flow.
- Day 9-11: UI dashboard + leaderboard; demo script.
- Day 12-14: polish, tests, deployment, video, submission docs.

## 13. Open Questions
- Do we ship as "Agent" or "Agent+Token" track?
- Which exact sources are stable enough for crawling?
- Do we include stake/slashing in MVP, or points-only?
