---
name: strategy-skill
description: Strategy MoltBot for proposing trade intents from finalized snapshots
metadata:
  openclaw:
    requires:
      env:
        - RELAYER_URL
        - BOT_ID
        - BOT_API_KEY
        - CHAIN_ID
        - STRATEGY_AA_ACCOUNT_ADDRESS
        - STRATEGY_AA_OWNER_PRIVATE_KEY
      bins:
        - node
        - npm
    primaryEnv: RELAYER_URL
    skillKey: strategy
---

# Strategy MoltBot Skill

The Strategy MoltBot is responsible for proposing structured trade intents based on finalized data snapshots. It evaluates market conditions, liquidity, and risk policies to decide whether to propose a trade or hold.
For NadFun venues, it must use lens quotes to derive `minAmountOut` and reject router mismatch.
In runtime, use `proposeIntentAndSubmit` to build a canonical proposal first, then submit only when explicit submit gating is satisfied.

## Credential Scope

- `STRATEGY_AA_OWNER_PRIVATE_KEY` is an **AA owner signing key** for strategy user operations.
- It must NOT be a treasury/custody/admin key.
- Prefer a dedicated, least-privilege key that only controls the strategy AA account.
- Legacy fallback `STRATEGY_PRIVATE_KEY` may exist in runtime for backward compatibility, but `STRATEGY_AA_OWNER_PRIVATE_KEY` is the recommended key.

## Submission Safety Gates

`proposeIntentAndSubmit` is guarded by default:

1. `STRATEGY_REQUIRE_EXPLICIT_SUBMIT=true` (default) requires explicit `submit=true`.
2. `STRATEGY_AUTO_SUBMIT=true` must be enabled to allow external submission.
3. `RELAYER_URL` is validated; enforce trusted hosts with `STRATEGY_TRUSTED_RELAYER_HOSTS`.
4. Without submit approval, function returns `decision=READY` and does not post to relayer or send onchain tx.

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
    "claimCount": "number"
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
    "claimCount": 19
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
2. Strategy AA `IntentBook.proposeIntent(...)`

This keeps offchain canonical intent and onchain intent registration aligned in the same skill timing.

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
