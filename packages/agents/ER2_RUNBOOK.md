# ER2 Runbook (ClawBot Core)

Target: verify strategy/participant bot actions against relayer + onchain flows from EC2.

## 1) Install
```bash
cd /path/to/claw-validation-market
npm install
npm run build -w @claw/protocol-sdk
npm run build -w @claw/agents
```

## 2) Env
```bash
cp packages/agents/.env.er2.example packages/agents/.env
# fill values, then:
set -a
source packages/agents/.env
set +a
```

Required minimum:
- `RELAYER_URL`
- `BOT_ID`
- `BOT_API_KEY`
- `FUND_ID`
- `CHAIN_ID`
- `RPC_URL`

For onchain actions additionally:
- `INTENT_BOOK_ADDRESS`
- `CLAW_CORE_ADDRESS`
- `STRATEGY_AA_ACCOUNT_ADDRESS`
- `STRATEGY_AA_OWNER_PRIVATE_KEY`
- `STRATEGY_AA_BUNDLER_URL`
- `STRATEGY_AA_ENTRYPOINT_ADDRESS`

## 3) Core smoke (single command)
```bash
npm run bot:smoke:e2e -w @claw/agents
```

This runs:
1. `clawbot-run --help`
2. participant verify routing
3. strategy set_aa routing
4. strategy propose_intent (only when network env is complete)

## 4) Manual strategy flow
```bash
# Propose
npm run clawbot:run -w @claw/agents -- \
  --role strategy \
  --action propose_intent \
  --fund-id "$FUND_ID" \
  --intent-file /tmp/intent.json \
  --execution-route-file /tmp/route.json

# Dry run core
npm run clawbot:run -w @claw/agents -- \
  --role strategy \
  --action dry_run_intent_execution \
  --intent-hash 0x... \
  --intent-file /tmp/intent.json \
  --execution-route-file /tmp/route.json

# Attest onchain
npm run clawbot:run -w @claw/agents -- \
  --role strategy \
  --action attest_intent_onchain \
  --fund-id "$FUND_ID" \
  --intent-hash 0x...

# Execute ready queue
npm run clawbot:run -w @claw/agents -- \
  --role strategy \
  --action execute_intent_onchain \
  --fund-id "$FUND_ID"
```

## 5) Manual participant flow
```bash
# Mine
npm run clawbot:run -w @claw/agents -- \
  --role participant \
  --action mine_claim \
  --fund-id "$FUND_ID" \
  --epoch-id 1 \
  --source-ref "https://www.reddit.com/r/CryptoCurrency/new.json?limit=10&raw_json=1" \
  --token-address 0x00000000000000000000000000000000000000a1 \
  --out-file /tmp/claim.mine.json

# Verify
npm run clawbot:run -w @claw/agents -- \
  --role participant \
  --action verify_claim \
  --claim-file /tmp/claim.mine.json

# Submit
npm run clawbot:run -w @claw/agents -- \
  --role participant \
  --action submit_claim \
  --claim-file /tmp/claim.mine.json
```
