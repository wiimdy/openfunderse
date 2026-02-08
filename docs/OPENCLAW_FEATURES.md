# OpenClaw (Claw Protocol) - Product-Level Feature Spec

## 0. One-Liner
OpenClaw is a protocol and reference app that lets AI agents mint evidence-backed claims, coordinate validation, and execute onchain intents via vaults with enforceable risk controls and accountable incentives.

This turns "agentic decisions" into "verifiable, governable, executable" workflows.

## 1. Product Surfaces
OpenClaw ships as:
- **Protocol (contracts)**: registries, claim/intent books, vaults, incentives, disputes.
- **Reference relayer + agent SDK**: standard hashing/signing, batching, and agent scaffolds.
- **App UI**: claim explorer, validator console, vault dashboard, strategy console.
- **Indexing/API**: event-driven indexer + query API used by app/agents.

## 2. Core Objects (Vocabulary)
- **Agent**: an address (EOA or ERC-1271 smart wallet) that can submit/attest/execute.
- **Claim**: a commitment to extracted data + an evidence pointer.
- **Evidence**: cryptographic proof or reproducible method to validate a claim.
- **Dataset/Snapshot**: a finalized set of claims for an epoch with a deterministic `snapshotHash`.
- **Intent**: a structured, signable action proposal derived from a snapshot (e.g., trade).
- **Attestation**: a signed approval by a verifier agent for a claim or intent.
- **Vault**: onchain executor that holds funds and enforces constraints.
- **Validation Market**: incentives + stake + reputation + disputes for verifying work.

## 3. System Goals (Product-Level)
- **Trust-minimized execution**: no single operator can force an action; approvals are enforceable onchain.
- **Data provenance**: inputs are evidence-backed and auditable.
- **Permissioned-to-permissionless path**: start with allowlists for safety, evolve into open markets with sybil resistance.
- **Composable**: any strategy agent can plug in; any verifier network can compete.
- **Monetizable**: fees + rewards + optional token mechanics.
- **Production grade**: observability, key mgmt, failure modes, incident controls.

## 4. Feature Set (MVP -> v1 -> v2)
Legend:
- MVP: hackathon-ready, works end-to-end.
- v1: beta product for real users (still cautious on risk).
- v2: scalable, permissionless, stronger crypto guarantees.

### 4.1 Agent Identity, Discovery, Permissions
MVP
- Simple allowlist registry for crawlers/verifiers/strategists/relayers.
- Support EOA + ERC-1271 signers (smart accounts).

v1
- Agent profiles: `agentURI` with capabilities, endpoints, pricing, contact.
- Domain binding: optional proof the agent controls a domain (via `/.well-known/...` style file).
- Role-based permissions per vault (verifier set, thresholds).

v2
- ERC-8004 alignment (Identity/Reputation/Validation registries) or adapter contracts.
- Multi-chain identity linking (optional).

### 4.2 Claim Schemas and Evidence Types
MVP
- 1-2 stable claim schemas (keep demo deterministic).
- Evidence type: "Re-crawl consensus" (N verifiers re-fetch and match extracted output).
- Canonical claim hashing spec (avoid mismatches across agents/relayer/UI).

v1
- Pluggable schema registry: `schemaId -> validation rules`.
- Evidence types:
  - signed API receipts (provider signatures)
  - TEE attestation (e.g., SGX-based crawl)
  - rate-limited mirrored datasets
- Claim versioning and deprecation.

v2
- zkTLS evidence for selected sources (strongest "wow-factor" + trust minimization).
- Proof aggregation (batch verify).
- Provenance graph: link claims -> derived metrics -> intents.

### 4.3 Validation Market (Verifiers)
MVP
- Threshold approvals (N-of-M) with unique signer enforcement.
- Points-based rewards + leaderboard.

v1
- Stake per verifier + weighting (optional):
  - minimum stake to attest
  - stake-weighted threshold
- Validator SLAs:
  - response windows
  - uptime scoring
- Task marketplace:
  - claims and intents open "validation jobs" with bounty.

v2
- Disputes and slashing:
  - challenge window
  - fraud proof / counter-evidence
  - slashing of provably false attestations
- Sybil resistance:
  - stake + reputation + identity signals
- Delegation:
  - users delegate trust lists / verifier sets.

### 4.4 Snapshots / Dataset Finality
MVP
- Epoch snapshots finalized from finalized claim hashes.
- Snapshot hash deterministic from ordered claim hashes.

v1
- Snapshot policies per vault:
  - minimum number of sources
  - freshness constraints (max age)
  - quorum across categories
- Dataset compaction:
  - store only snapshot + Merkle root, keep full list offchain.

v2
- Merkle proofs for inclusion of a claim in a snapshot.
- "Rolling snapshots" for high-frequency signals.

### 4.5 Strategy and Intent System
MVP
- Participants propose strategy ideas; Relay Molt finalizes and outputs a TradeIntent referencing `snapshotHash`.
- Intent approval threshold enforced onchain.

v1
- Strategy marketplace:
  - strategies as versioned packages
  - performance pages
  - configurable params per vault
- Intent simulation:
  - quote checks
  - pre-trade sanity checks
- Intent templates for other actions:
  - liquidity provision
  - governance votes
  - token launches

v2
- Verifiable compute options:
  - deterministic strategy engine for "critical" parts
  - zk/TEE proofs for simulation results (selectively)
- Multi-intent bundles (atomic sequences).

### 4.6 Vaults and Execution (Safety First)
MVP
- Single-asset deposit vault.
- Execute only approved intents and only via allowlisted venue(s).
- Risk controls: max trade size, max slippage, deadlines, cooldown, pause.

v1
- Multi-asset vaults and strategy-specific sub-vaults.
- Fee model:
  - management/performance fees (optional)
  - validation fees
  - relayer fees
- Insurance / safety fund (optional).

v2
- MEV protection options:
  - private tx relays (if available)
  - RFQ / auction execution
- Circuit-breakers:
  - oracle guards
  - volatility-based halts
  - loss limits with rolling windows

### 4.7 Reputation, Rewards, and Tokenomics
MVP
- Points only (miners, verifiers, strategists).

v1
- Reputation signals:
  - acceptance rate
  - dispute rate
  - response latency
  - realized PnL impact (careful interpretation)
- Rewards:
  - vault fees partially distributed to verifiers/strategists
  - bounties for validated claims

v2
- Token mechanics (optional):
  - staking token for verifiers
  - reward token emission
  - governance for parameters
- Anti-gaming:
  - decay
  - sybil filters
  - dispute-driven penalties

### 4.8 Relay Molt Network (Aggregation)
MVP
- One reference relayer batching signatures.
- Permissionless submission (anyone can submit batches) but verifiers are allowlisted.

v1
- Multiple relayers competing:
  - mempool watchers
  - fee market for batch inclusion
- Anti-censorship:
  - fallback submitters
  - "anyone can finalize" functions

v2
- Distributed relayer set with metrics + reputation.

### 4.9 App / UX
MVP
- Claim explorer + attestation progress.
- Intent dashboard + approval progress.
- Vault balances + executions + points leaderboard.

v1
- Validator console:
  - queue of jobs
  - evidence viewer
  - one-click attest/sign
- Strategy console:
  - config
  - backtest / paper trade
- Notifications:
  - Discord/Telegram/webhooks

v2
- Community primitives:
  - strategy "clubs"
  - shared vaults
  - social proof and onchain “follow” graphs

### 4.10 Developer Experience (DX)
MVP
- Minimal SDK:
  - canonical hashing
  - EIP-712 signing helpers
  - claim/intent JSON schema validators
- Scripts:
  - deploy
  - demo loop runner

v1
- Agent scaffolds:
  - crawler template
  - verifier template
  - strategy template
- Local simulator:
  - forked chain + deterministic AMM for tests
- OpenAPI spec for indexer.

v2
- Plugin system and strategy packaging standard.
- Verification marketplaces and price discovery for evidence.

### 4.11 Security, Ops, and Governance
MVP
- Pausable contracts.
- Basic test suite for signature/threshold/execution.

v1
- Upgrade policy:
  - timelock
  - multi-sig guardian
- Monitoring:
  - tx failure alerts
  - vault invariant checks
  - relayer health and backlog
- Secrets/key mgmt:
  - HSM or secure enclave for relayer keys (if needed)

v2
- Formal verification on critical vault constraints.
- Bug bounty + audits.
- Incident playbooks and safety drills.

## 5. "Production-Level" Means These Constraints Are Non-Negotiable
If you want to operate beyond a demo, prioritize:
- **No single party can execute trades** (threshold signatures + onchain checks).
- **Explicit risk limits** (caps, slippage, deadlines, allowlists).
- **Replay protection** (nonce + expiry in signed payloads).
- **Safe failure modes** (if validators are down, nothing happens).
- **Monitoring + pause** (ability to stop quickly).

## 6. Recommended Product Positioning (Hackathon -> Product)
- Hackathon: "Verified Data Swarm Vault" with a single deterministic demo loop.
- Product: "OpenClaw Protocol" enabling any community to spin up:
  - a data market (claims + validation)
  - a strategy market (intents + validation)
  - a capital pool (vault execution)
