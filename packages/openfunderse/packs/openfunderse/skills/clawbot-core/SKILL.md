---
name: clawbot-core
description: Unified ClawBot skill for strategy and participant actions over relayer and onchain contracts.
version: 1.0.0
metadata:
  openclaw:
    requires:
      env:
        - RELAYER_URL
        - BOT_ID
        - BOT_API_KEY
        - FUND_ID
        - RPC_URL
        - CHAIN_ID
      bins:
        - node
        - npm
    primaryEnv: RELAYER_URL
    skillKey: clawbot-core
---

# ClawBot Core Skill

Unified runtime entrypoint:
- `npm run clawbot:run -w @claw/agents -- --role <strategy|participant> --action <action> ...`

## Global Input Contract
```json
{
  "role": "strategy | participant",
  "action": "string",
  "params": {
    "fundId": "string",
    "...": "action specific"
  }
}
```

## Strategy Actions

### `propose_intent`
CLI mapping: `strategy-propose`
```json
{
  "fundId": "string",
  "intentFile": "/path/intent.json",
  "executionRouteFile": "/path/route.json",
  "maxNotional": "optional bigint",
  "intentUri": "optional string"
}
```

Intent JSON schema:
```json
{
  "intentVersion": "V1",
  "vault": "0x...",
  "action": "BUY | SELL",
  "tokenIn": "0x...",
  "tokenOut": "0x...",
  "amountIn": "bigint string",
  "minAmountOut": "bigint string",
  "deadline": "unix seconds string",
  "maxSlippageBps": "bigint string",
  "snapshotHash": "0x<32bytes>"
}
```

Execution route JSON schema:
```json
{
  "tokenIn": "0x...",
  "tokenOut": "0x...",
  "quoteAmountOut": "bigint string",
  "minAmountOut": "bigint string",
  "adapter": "0x...",
  "adapterData": "0x..."
}
```

### `dry_run_intent_execution`
CLI mapping: `strategy-dry-run-intent`
```json
{
  "intentHash": "0x<32bytes>",
  "intentFile": "/path/intent.json",
  "executionRouteFile": "/path/route.json",
  "coreAddress": "optional 0x..., defaults CLAW_CORE_ADDRESS"
}
```
Output includes:
- `pass` boolean
- full `dryRun` struct from `ClawCore.dryRunIntentExecution`

### `attest_intent_onchain`
CLI mapping: `strategy-attest-onchain`
Required params:
```json
{ "fundId": "string", "intentHash": "0x<32bytes>" }
```

### `execute_intent_onchain`
CLI mapping: `strategy-execute-ready`
Required params:
```json
{ "fundId": "string" }
```

## Participant Actions

### `mine_claim`
CLI mapping: `participant-mine`
```json
{
  "fundId": "string",
  "epochId": 1,
  "sourceRef": "https://...",
  "tokenAddress": "0x..."
}
```

### `verify_claim`
CLI mapping: `participant-verify`
```json
{
  "claimFile": "/path/claim.json",
  "reproducible": false,
  "maxDataAgeSeconds": 300
}
```

### `submit_claim`
CLI mapping: `participant-submit`
```json
{
  "claimFile": "/path/claim.json",
  "submit": true
}
```

### `attest_claim`
CLI mapping: `participant-attest`
```json
{
  "fundId": "string",
  "epochId": 1,
  "claimHash": "0x<32bytes>",
  "submit": true
}
```

## Safety Rules
1. Fail closed when relayer auth/scope/role checks fail.
2. Never bypass SDK canonical hashing and EIP-712 signing.
3. Use `dry_run_intent_execution` before execute in production flows.
4. Keep role separation in API auth even if crawler/verifier share one wallet.
5. For participant submit/attest, require explicit submit gating (`--submit` + `PARTICIPANT_AUTO_SUBMIT=true`).
