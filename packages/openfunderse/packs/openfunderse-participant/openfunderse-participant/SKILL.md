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

## Relayer Bot Credential Model (Important)

This skill sends write requests to relayer with:
- `x-bot-id: BOT_ID`
- `x-bot-api-key: BOT_API_KEY`

For production, relayer should validate these via **DB-backed credentials** (Supabase `bot_credentials`) instead of Vercel env `BOT_API_KEYS`.

**Participant credential registration is NOT done by the participant bot.**
It must be registered by the **strategy bot** when it registers the participant:
- Strategy calls `POST /api/v1/funds/{fundId}/bots/register`
- Include `botId` + `botAddress` + `botApiKeySha256` (sha256 hex from participant `bot-init`) and optional `botScopes`

If the participant key is not registered, relayer will reject participant write APIs with `401`.

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

## Rules

1. **Supported Tasks Only**: Use only `propose_allocation`, `validate_allocation_or_intent`, `submit_allocation`.
2. **Schema Rule**: Claim schema is `AllocationClaimV1` only (`claimVersion`, `fundId`, `epochId`, `participant`, `targetWeights`, `horizonSec`, `nonce`, `submittedAt`).
3. **Weights Rule**: `targetWeights` must be integer, non-negative, non-empty, and sum > 0.
4. **Index Mapping Rule**: `targetWeights[i]` MUST map to strategy `riskPolicy.allowlistTokens[i]` in the same order.
5. **Scope Validation**: If subject `fundId`/`epochId` differs from task scope, return `FAIL`.
6. **Hash Validation**: For CLAIM, recompute canonical hash via SDK and compare with `subjectHash`; mismatch returns `FAIL`.
7. **Submit Endpoint**: `submit_allocation` sends claim to relayer `POST /api/v1/funds/{fundId}/claims`.
8. **No Implicit Submit**: Submit only when explicit submit gate is satisfied.
9. **Trusted Relayer**: In production, set `PARTICIPANT_TRUSTED_RELAYER_HOSTS` and avoid arbitrary relayer URLs.
10. **Key Hygiene**: Use dedicated participant keys only; never use custody/admin keys.
11. **Env Source Priority**: Resolve runtime env from `/home/ubuntu/.openclaw/openclaw.json` (`env.vars`) before local `.env*` files.
12. **Legacy Tasks Disabled**: Do not use `mine_claim`, `verify_claim_or_intent_validity`, `submit_mined_claim`, `attest_claim`.
