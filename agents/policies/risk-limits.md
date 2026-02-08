# Risk Limits (POC Baseline)

These limits are meant to make “bad intent” fail closed.
Participants and verifiers must enforce them before producing/approving intents (and Relay Molt must refuse to aggregate/settle intents that violate them).

## Defaults (suggested)
- `dry_run=true` unless explicitly overridden
- `maxNotionalUSD`: 100 (start small; raise later)
- `slippageBpsCap`: 50 (0.50%)
- `deadlineSeconds`: 300 (5 minutes)

## Allowlist model
- `venueAllowlist`: only known routers/venues per chain
- `tokenAllowlist`: start with a minimal set (e.g., WETH/USDC + 1-2 target tokens)

## Hard denials
DENY if any are true:
- token not in allowlist
- venue not in allowlist
- `slippageBps` > cap
- `notionalUSD` > max
- deadline is missing or too long
- intent does not reference `snapshotHash`
