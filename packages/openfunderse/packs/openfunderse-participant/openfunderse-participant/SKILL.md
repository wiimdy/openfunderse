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

## Quick Start

1) Install (pick one). You do **not** need to run both:

Manual (direct installer; run in a Node project dir, or `npm init -y` first):

```bash
npm init -y && npx @wiimdy/openfunderse@latest install openfunderse-participant --with-runtime
```

ClawHub:

```bash
npx clawhub@latest install openfunderse-participant
```

2) Rotate the temporary bootstrap key and write a fresh participant wallet to env:

```bash
npx @wiimdy/openfunderse@latest bot-init \
  --skill-name participant \
  --yes
```

`bot-init` updates an existing `.env.participant`.  
If the env file is missing, run install first (without `--no-init-env`) or pass `--env-path`.

### Environment Source of Truth (Hard Rule)

- In OpenClaw runtime on Ubuntu, treat `/home/ubuntu/.openclaw/openclaw.json` (`env.vars`) as the canonical env source.
- Do not require manual `.env` sourcing for normal skill execution.
- If `.env*` and `openclaw.json` disagree, use `openclaw.json` values.
- When user asks env setup, direct them to update `openclaw.json` first.

3) Optional local shell export (debug only):

```bash
set -a; source ~/.openclaw/workspace/.env.participant; set +a
```

This step is not required for normal OpenClaw skill execution.

Telegram slash commands:

```text
/propose_allocation --fund-id <id> --epoch-id <n> --target-weights <w1,w2,...>
/validate_allocation --claim-file <path>
/submit_allocation --claim-file <path> --submit
/allocation_e2e --fund-id <id> --epoch-id <n> --target-weights <w1,w2,...> [--submit]
```

Notes:
- Slash parser accepts underscores, so `/submit_allocation` equals `/submit-allocation`.
- `key=value` style is also accepted (`fund_id=demo-fund`).
- On first install, register these commands in Telegram via `@BotFather` -> `/setcommands`.

OpenClaw note:
- `install` / `bot-init` sync env keys into `~/.openclaw/openclaw.json` (`env.vars`) by default.
- `bot-init` also runs `openclaw gateway restart` after a successful env sync, so the gateway picks up updates.
- Use `--no-sync-openclaw-env` for file-only behavior, or `--no-restart-openclaw-gateway` to skip the restart.
- If env still looks stale: run `openclaw gateway restart` and verify values in `/home/ubuntu/.openclaw/openclaw.json`.

Note:
- The scaffold includes a temporary public key placeholder by default.
- Always run `bot-init` before funding or running production actions.
- `bot-init` generates a random `BOT_API_KEY` when current value is missing or placeholder.

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

## Rules

1. **Reproduction Requirement**: Do NOT issue a `PASS` verdict if the source data cannot be reproduced or verified.
2. **Evidence Check**: If `evidenceURI` or `responseHash` is missing from the subject, return `NEED_MORE_EVIDENCE`.
3. **Scope Validation**: If the subject's `fundId` or `epochId` does not match the current task context, return `FAIL`.
4. **Key Hygiene**: Use only dedicated participant/verifier keys. Never use custody/admin keys for attest operations.
5. **Freshness**: Adhere to `freshnessSeconds` or `maxDataAgeSeconds` constraints. If data is stale, the verdict should reflect this.
6. **Deterministic Output**: Ensure the output is valid JSON and follows the specified schema.
7. **Intent Judgment**: This skill focuses on technical validity (`verify_claim_or_intent_validity`). Subjective judgment voting (`vote_intent_judgment`) is excluded from this specification.
8. **Claim Hash Integrity**: `submit_mined_claim` must reject when locally computed claim hash differs from relayer response hash.
9. **Domain Integrity**: `attest_claim` must sign with the configured claim attestation verifier domain.
10. **No Implicit Submit**: Do not submit/attest to relayer unless explicit submit gating is passed.
11. **Trusted Relayer**: In production, set `PARTICIPANT_TRUSTED_RELAYER_HOSTS` and avoid arbitrary relayer URLs.
12. **Env Source Priority**: Resolve runtime env from `/home/ubuntu/.openclaw/openclaw.json` (`env.vars`) before local `.env*` files.
