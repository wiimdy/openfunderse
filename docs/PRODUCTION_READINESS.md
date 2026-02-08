# Production Readiness Checklist (OpenClaw)

If you truly want "real product level", this is the bar beyond a hackathon demo.

## 1. Protocol Correctness
- Canonical encoding spec for claim/intent hashing (documented and tested).
- EIP-712 typed data for all signatures, with:
  - chainId binding
  - contract binding
  - nonce
  - expiry
- Snapshot determinism: strict ordering rules and tests across languages.
- Strict event design for indexing (no ambiguous fields).

## 2. Vault Safety Controls
- Allowlist tokens and venues (start tight).
- Enforce:
  - max trade size
  - slippage caps (minOut)
  - deadlines
  - cooldown between trades
  - daily/rolling loss limits (optional but recommended for real funds)
- Emergency pause + safe withdrawal paths.
- Reentrancy guards and safe ERC20 transfers.

## 3. Adversarial Robustness
- Sybil defense plan:
  - allowlist -> stake gate -> reputation weighting -> disputes/slashing
- Censorship resistance:
  - permissionless batch submission
  - anyone-can-finalize functions
- Dispute resolution:
  - challenge windows
  - evidence posting rules
  - conservative slashing

## 4. Offchain Reliability (Agents + Relayers)
- Idempotent relayer submissions (safe retries).
- Queueing and backpressure for validation jobs.
- Key management:
  - separate keys by role
  - hardware-backed signing if possible
- Rate limiting and sandboxing for crawlers (avoid bans and flaky data).

## 5. Observability and Operations
- Monitoring:
  - vault invariants
  - pending intents and expiries
  - relayer backlog
  - failed txs
- Alerting:
  - on-call channels and severity levels
- Runbooks:
  - pause procedures
  - incident response steps
  - key rotation

## 6. Security Process
- Internal review: threat model per release.
- External audit for:
  - signature verification logic
  - vault execution paths
  - upgradeability controls
- Bug bounty when mainnet-facing.

## 7. UX and Trust
- Clear UI for:
  - why a trade was executed (snapshot + evidence links)
  - who approved it (verifier set)
  - what constraints applied (caps, slippage)
- Disclosures:
  - not financial advice
  - risk warnings
  - beta status

## 8. Compliance / Risk (Non-technical)
- Decide target users (retail vs sophisticated) and jurisdictions.
- Decide if you need KYC for certain flows.
- Avoid presenting as an "investment product" in a way that triggers obligations without counsel.

