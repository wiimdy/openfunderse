---
name: openfunderse-strategy
description: OpenFunderse Strategy bot for proposing and gated submission of trade intents
always: false
disable-model-invocation: false
metadata:
  openclaw:
    installCommand: npx @wiimdy/openfunderse@latest install openfunderse-strategy --with-runtime
    requires:
      env:
        - RELAYER_URL
        - BOT_ID
        - STRATEGY_ADDRESS
        - CHAIN_ID
        - RPC_URL
        - STRATEGY_PRIVATE_KEY
        - INTENT_BOOK_ADDRESS
        - NADFUN_EXECUTION_ADAPTER_ADDRESS
        - ADAPTER_ADDRESS
        - NADFUN_LENS_ADDRESS
        - NADFUN_BONDING_CURVE_ROUTER
        - NADFUN_DEX_ROUTER
        - NADFUN_WMON_ADDRESS
        - VAULT_ADDRESS
        - STRATEGY_AUTO_SUBMIT
        - STRATEGY_REQUIRE_EXPLICIT_SUBMIT
        - STRATEGY_TRUSTED_RELAYER_HOSTS
        - STRATEGY_ALLOW_HTTP_RELAYER
        - STRATEGY_MAX_IMPACT_BPS
        - STRATEGY_SELL_TAKE_PROFIT_BPS
        - STRATEGY_SELL_STOP_LOSS_BPS
        - STRATEGY_SELL_MAX_HOLD_SECONDS
        - STRATEGY_DEADLINE_MIN_SECONDS
        - STRATEGY_DEADLINE_BASE_SECONDS
        - STRATEGY_DEADLINE_MAX_SECONDS
        - STRATEGY_DEADLINE_PER_CLAIM_SECONDS
    primaryEnv: STRATEGY_PRIVATE_KEY
    skillKey: strategy
---

# Strategy MoltBot Skill

The Strategy MoltBot is responsible for proposing structured trade intents based on finalized data snapshots. It evaluates market conditions, liquidity, and risk policies to decide whether to propose a trade or hold.
For NadFun venues, it must use lens quotes to derive `minAmountOut` and reject router mismatch.
In runtime, use `proposeIntentAndSubmit` to build a canonical proposal first, then submit only when explicit submit gating is satisfied.

## Quick Start

1) Install (pick one). You do **not** need to run both:

Manual (direct installer; run in a Node project dir, or `npm init -y` first):

```bash
npm init -y && npx @wiimdy/openfunderse@latest install openfunderse-strategy --with-runtime
```

ClawHub:

```bash
npx clawhub@latest install openfunderse-strategy
```

2) Rotate the temporary bootstrap key and write a fresh strategy wallet to env:

```bash
npx @wiimdy/openfunderse@latest bot-init \
  --skill-name strategy \
  --yes
```

`bot-init` updates an existing `.env.strategy`.  
If the env file is missing, run install first (without `--no-init-env`) or pass `--env-path`.

### Environment Source of Truth (Hard Rule)

- In OpenClaw runtime on Ubuntu, treat `/home/ubuntu/.openclaw/openclaw.json` (`env.vars`) as the canonical env source.
- Do not require manual `.env` sourcing for normal skill execution.
- If `.env*` and `openclaw.json` disagree, use `openclaw.json` values.
- When user asks env setup, direct them to update `openclaw.json` first.

3) Optional local shell export (debug only):

```bash
set -a; source ~/.openclaw/workspace/.env.strategy; set +a
```

This step is not required for normal OpenClaw skill execution.

Telegram slash commands:

```text
/propose_intent --fund-id <id> --intent-file <path> --execution-route-file <path>
/dry_run_intent --intent-hash <0x...> --intent-file <path> --execution-route-file <path>
/attest_intent --fund-id <id> --intent-hash <0x...>
/execute_intent --fund-id <id> [--limit <n>]
/create_fund --fund-id <id> --fund-name <name> --deploy-config-file <path>
```

Notes:
- Slash parser accepts underscores, so `/propose_intent` equals `/propose-intent`.
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
- `bot-init` generates a new wallet (private key + address) and writes it into the role env file.

## Relayer Bot Authentication (Signature)

This skill authenticates relayer write APIs with an EIP-191 message signature (no `BOT_API_KEY`).

Message format:
- `openfunderse:auth:<botId>:<timestamp>:<nonce>`

Required headers:
- `x-bot-id: BOT_ID`
- `x-bot-signature: <0x...>`
- `x-bot-timestamp: <unix seconds>`
- `x-bot-nonce: <uuid/random>`

Relayer verifies this signature against Supabase `fund_bots.bot_address`.

Role-derived scopes:
- strategy: `intents.propose`, `bots.register`, `funds.bootstrap`
- participant: `claims.submit`, `intents.attest`

### Strategy bootstrap (first registration)

`POST /api/v1/funds/sync-by-strategy` supports a one-time bootstrap when the strategy bot is not yet registered.
Include `auth` in the JSON body (signed by `strategyBotAddress`) with:
- `signature`
- `nonce`
- `expiresAt`

After a successful sync, subsequent calls can use normal signature headers.

## Credential Scope

- `STRATEGY_PRIVATE_KEY` is the **strategy signer key (EOA)** used for onchain strategy operations.
- It must NOT be a treasury/custody/admin key.
- Prefer a dedicated, least-privilege signer account only for strategy execution.
- Keep this key in a secret manager/HSM when possible, rotate regularly, and use testnet key first.

## Invocation Policy

- Model invocation is enabled for discoverability (`disable-model-invocation: false`).
- Keep submit guards strict (`STRATEGY_REQUIRE_EXPLICIT_SUBMIT=true`, `STRATEGY_AUTO_SUBMIT=false`) unless intentionally overridden.
- Onchain or relayer submission should happen only after explicit user approval.

## Submission Safety Gates

`proposeIntentAndSubmit` is guarded by default:

1. `STRATEGY_REQUIRE_EXPLICIT_SUBMIT=true` (default) requires explicit `submit=true`.
2. `STRATEGY_AUTO_SUBMIT=true` must be enabled to allow external submission.
3. `RELAYER_URL` is validated; enforce trusted hosts with `STRATEGY_TRUSTED_RELAYER_HOSTS`.
4. Without submit approval, function returns `decision=READY` and does not post to relayer or send onchain tx.
5. Keep `STRATEGY_AUTO_SUBMIT=false` in production unless you intentionally enable unattended submission.

## Input

The skill accepts a `propose_intent` task with the following schema:

```json
{
  "taskType": "propose_intent",
  "fundId": "string",
  "roomId": "string",
  "epochId": "number",
  "snapshot": {
    "snapshotHash": "string",
    "finalized": "boolean",
    "claimCount": "number",
    "aggregateWeights": ["string | number (optional)"]
  },
  "marketState": {
    "network": "number",
    "nadfunCurveState": "object",
    "liquidity": "object",
    "volatility": "object",
    "positions": [
      {
        "token": "string",
        "quantity": "string | number",
        "costBasisAsset": "string | number (optional)",
        "openedAt": "unix seconds or milliseconds (optional)"
      }
    ]
  },
  "riskPolicy": {
    "maxNotional": "string",
    "maxSlippageBps": "number",
    "allowlistTokens": ["string"],
    "allowlistVenues": ["string"]
  }
}
```

### Example Input
```json
{
  "taskType": "propose_intent",
  "fundId": "fund-001",
  "roomId": "telegram-room-abc",
  "epochId": 12,
  "snapshot": {
    "snapshotHash": "0xabc123...",
    "finalized": true,
    "claimCount": 19,
    "aggregateWeights": ["7000", "3000"]
  },
  "marketState": {
    "network": 10143,
    "nadfunCurveState": {},
    "liquidity": {},
    "volatility": {},
    "positions": [
      {
        "token": "0xtoken1...",
        "quantity": "1200000000000000000",
        "costBasisAsset": "1000000000000000000",
        "openedAt": 1730000000
      }
    ]
  },
  "riskPolicy": {
    "maxNotional": "1000",
    "maxSlippageBps": 80,
    "allowlistTokens": ["0xtoken1...", "0xtoken2..."],
    "allowlistVenues": ["NadFun", "UniswapV3"]
  }
}
```

## Output

The skill returns either a `PROPOSE` or `HOLD` decision.

### PROPOSE Decision
Returned when market conditions meet the risk policy and a profitable trade is identified.

```json
{
  "status": "OK",
  "taskType": "propose_intent",
  "fundId": "string",
  "epochId": "number",
  "decision": "PROPOSE",
  "intent": {
    "intentVersion": "V1",
    "fundId": "string",
    "roomId": "string",
    "epochId": "number",
    "vault": "string",
    "action": "BUY | SELL",
    "tokenIn": "string",
    "tokenOut": "string",
    "amountIn": "string",
    "minAmountOut": "string",
    "deadline": "number",
    "maxSlippageBps": "number",
    "snapshotHash": "string"
  },
  "executionPlan": {
    "venue": "NADFUN_BONDING_CURVE | NADFUN_DEX",
    "router": "string",
    "quoteAmountOut": "string"
  },
  "reason": "string",
  "riskChecks": {
    "allowlistPass": "boolean",
    "notionalPass": "boolean",
    "slippagePass": "boolean",
    "deadlinePass": "boolean"
  },
  "confidence": "number",
  "assumptions": ["string"]
}
```

### Guarded Submit Flow
When using `proposeIntentAndSubmit` with explicit submit gates satisfied, a `PROPOSE` decision is followed by:
1. Relayer `POST /api/v1/funds/{fundId}/intents/propose`
2. Strategy signer (EOA) `IntentBook.proposeIntent(...)`

This keeps offchain canonical intent and onchain intent registration aligned in the same skill timing.

### Relayer + Onchain Execution Workflow
For end-to-end execution, strategy/relayer interaction follows:
1. (Optional snapshot source) relayer `GET /api/v1/funds/{fundId}/epochs/latest` for `snapshotHash`, `claimCount`, `aggregateWeights`.
2. Propose intent offchain: `POST /api/v1/funds/{fundId}/intents/propose`.
3. Register onchain intent: `IntentBook.proposeIntent(...)`.
4. Fetch threshold attestations: `GET /api/v1/funds/{fundId}/intents/{intentHash}/onchain-bundle`.
5. Submit onchain attestations: `IntentBook.attestIntent(...)`, then ack relayer `POST /api/v1/funds/{fundId}/intents/{intentHash}/onchain-attested`.
6. Poll executable jobs: `GET /api/v1/funds/{fundId}/intents/ready-execution`.
7. Dry-run/execute via core: `ClawCore.dryRunIntentExecution(...)` then `ClawCore.executeIntent(...)`.
8. Ack execution result to relayer:
   - success: `POST /api/v1/funds/{fundId}/intents/{intentHash}/onchain-executed`
   - failure/retry: `POST /api/v1/funds/{fundId}/intents/{intentHash}/onchain-failed`

### HOLD Decision
Returned when no trade is proposed due to risk constraints or market conditions.

```json
{
  "status": "OK",
  "taskType": "propose_intent",
  "fundId": "string",
  "roomId": "string",
  "epochId": "number",
  "decision": "HOLD",
  "reason": "string",
  "confidence": "number",
  "assumptions": ["string"]
}
```

## Rules

1. **Finality Requirement**: Do NOT propose an intent unless `snapshot.finalized` is `true`.
2. **Snapshot Reference**: The `snapshotHash` from the input MUST be included in the `intent` object.
3. **Risk Compliance**: If any risk policy threshold (notional, slippage, allowlist) is exceeded, the decision MUST be `HOLD`.
4. **NadFun Specifics**: Evaluate liquidity, slippage, and bonding curve status (pre/post graduation) separately for NadFun tokens.
5. **Proposal Only**: Assume the agent has proposal rights only, not direct execution rights.
6. **Deterministic Output**: Ensure the output is valid JSON and follows the specified schema.
7. **Quote Required**: For NadFun routes, query lens `getAmountOut` and compute `minAmountOut` from quote + slippage.
8. **No Zero MinOut**: Never propose with `minAmountOut=0`.
9. **Fail Closed**: If quote fails or returned router is not allowlisted, return `HOLD`.
10. **Sell First**: If a token position exists, evaluate `SELL` triggers first (`take-profit`, `stop-loss`, `time-exit`) before considering `BUY`.
11. **Timestamp Normalization**: `openedAt` may be in seconds or milliseconds; normalize before age-based exits.
12. **No Implicit Submit**: Do not submit to relayer/onchain unless explicit submit gating is passed.
13. **Trusted Relayer**: In production, set `STRATEGY_TRUSTED_RELAYER_HOSTS` and avoid arbitrary relayer URLs.
14. **Env Source Priority**: Resolve runtime env from `/home/ubuntu/.openclaw/openclaw.json` (`env.vars`) before local `.env*` files.
