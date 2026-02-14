---
name: openfunderse-participant
description: Participant MoltBot for allocation proposal, validation, and submission
metadata:
  openclaw:
    installCommand: npx @wiimdy/openfunderse@latest install openfunderse-participant --with-runtime
    requires:
      env:
        - RELAYER_URL
        - PARTICIPANT_PRIVATE_KEY
        - BOT_ID
        - BOT_API_KEY
        - CHAIN_ID
        - PARTICIPANT_ADDRESS
      bins:
        - node
        - npm
    primaryEnv: RELAYER_URL
    skillKey: participant
---

# Participant MoltBot Skill

Participant role proposes and validates `AllocationClaimV1` only.

## Quick Start (ClawHub Users)

1) Install the skill:

```bash
npx clawhub@latest install openfunderse-participant
```

2) Install runtime + generate env scaffold:

```bash
npx @wiimdy/openfunderse@latest install openfunderse-participant --with-runtime
```

3) Rotate bootstrap key and write a fresh participant wallet to env:

```bash
npx @wiimdy/openfunderse@latest bot-init \
  --skill-name participant \
  --yes
```

4) Load env for the current shell:

```bash
set -a; source .env.participant; set +a
```

OpenClaw note:
- `install` / `bot-init` sync env keys into `~/.openclaw/openclaw.json` (`env.vars`) by default.
- Use `--no-sync-openclaw-env` if you want file-only behavior.

## Claim model

`propose_allocation` outputs canonical allocation claim:
- `claimVersion: "v1"`
- `fundId`, `epochId`, `participant`
- `targetWeights[]` (integer, non-negative, sum > 0)
- `horizonSec`, `nonce`, `submittedAt`

No crawl/evidence/sourceRef schema is used.

Vector mapping rule:
- `targetWeights[i]` maps to strategy `riskPolicy.allowlistTokens[i]`.
- Participants must submit weights in the same token order used by the strategy allowlist.

## Submission safety gates

`submit_allocation` is guarded by default:
1. `PARTICIPANT_REQUIRE_EXPLICIT_SUBMIT=true` requires explicit `submit=true`.
2. `PARTICIPANT_AUTO_SUBMIT=true` must be enabled for network transmission.
3. `RELAYER_URL` host is checked by `PARTICIPANT_TRUSTED_RELAYER_HOSTS` when set.

If gate is closed, return `decision=READY` (no submit).

## Input contracts

### `propose_allocation`
```json
{
  "taskType": "propose_allocation",
  "fundId": "string",
  "roomId": "string",
  "epochId": "number",
  "allocation": {
    "participant": "0x... optional",
    "targetWeights": ["7000", "3000"],
    "horizonSec": 3600,
    "nonce": 1739500000
  }
}
```

### `validate_allocation_or_intent`
```json
{
  "taskType": "validate_allocation_or_intent",
  "fundId": "string",
  "roomId": "string",
  "epochId": "number",
  "subjectType": "CLAIM | INTENT",
  "subjectHash": "0x...",
  "subjectPayload": "object",
  "validationPolicy": {
    "reproducible": true,
    "maxDataAgeSeconds": 300
  }
}
```

### `submit_allocation`
```json
{
  "taskType": "submit_allocation",
  "fundId": "string",
  "epochId": "number",
  "observation": "propose_allocation output observation",
  "submit": true
}
```

## Verification rules

1. Claim must include required `AllocationClaimV1` fields.
2. `fundId/epochId` must match request scope.
3. Recompute canonical hash using SDK and compare with `subjectHash`.
4. Missing required fields -> `NEED_MORE_EVIDENCE`.
5. Scope/hash mismatch -> `FAIL`.
6. Deterministic match -> `PASS`.
