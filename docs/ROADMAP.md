# OpenClaw Roadmap

This roadmap assumes you want a hackathon-grade demo quickly, then evolve into a real product.

## Phase 0: Hackathon Demo (2 weeks)
Objective: ship the "hero loop" end-to-end, deterministic and judge-friendly.

Ship
- Claim schema V1 (2-3 sources, stable)
- ClaimBook + IntentBook + Vault (risk controls + pause)
- Threshold verifier attestations (allowlist verifiers)
- Reference relayer batching signatures
- Simple strategy agent (rule-based is fine) producing TradeIntent
- UI dashboard + leaderboard
- Demo AMM (recommended) for deterministic execution

Defer
- slashing/disputes
- zkTLS (optional if you can make it reliable)
- permissionless verifiers

## Phase 1: Beta (Weeks 3-6)
Objective: let real users try it with tight risk constraints.

Ship
- ERC-1271 support for verifier/strategy signers
- Multi-relayer support (anyone can submit batches)
- Indexer + query API
- Strategy configuration UI
- Snapshot policies (freshness, min sources)
- Basic fee model (vault execution fee + validator fee)

Hardening
- full integration tests (agent -> relayer -> contracts -> UI)
- monitoring and alerting
- upgrade policy (timelock + multisig)

## Phase 2: Mainnet-Ready (Months 2-4)
Objective: stronger trust minimization and adversarial robustness.

Ship
- Stake-based verifier gating (min stake)
- Challenge window for claims/intents
- Simple slashing logic for provably bad attestations (start conservative)
- Reputation metrics and weighting
- Safer execution paths (RFQ, private tx where available)

Security
- external audit for vault + signature logic
- bug bounty program

## Phase 3: Protocol Expansion (Months 4-9)
Objective: become a general "validated intent" protocol for agents, not just trading.

Ship
- More intent types:
  - liquidity provision
  - governance actions
  - token launch automation (nad.fun integration)
- zkTLS evidence for select sources
- Merkleized snapshots (compact onchain)
- Strategy marketplace + packaging

Decentralization
- permissionless verifier market (stake + sybil controls)
- governance parameters via token/DAO (optional)

