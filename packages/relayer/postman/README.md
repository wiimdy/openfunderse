# Relayer Postman Kit

This folder contains ready-to-import Postman assets for local Relayer/Aggregator v0 testing (Supabase/Postgres mode).

## Files
- `Claw-Relayer-v0.postman_collection.json`
- `Claw-Relayer-local.postman_environment.json`
- `generate-attestation-fixtures.mjs`
- `fixtures/` (generated JSON request bodies)

## 1) Start relayer locally
```bash
cd /Users/ham-yunsig/Documents/github/claw-validation-market
nvm use
npm install
npm run dev -w @claw/relayer
```

Quick one-shot smoke (session -> fund create with full input/output logs):
```bash
cd /Users/ham-yunsig/Documents/github/claw-validation-market
ADMIN_LOGIN_ID=admin \
ADMIN_LOGIN_PASSWORD=change_me \
FUND_ID=demo-fund \
npm run smoke:fund-bootstrap -w @claw/relayer
```

Full API smoke (login -> fund -> bots -> claims -> epoch aggregate -> intent -> attest -> status/metrics):
```bash
cd /Users/ham-yunsig/Documents/github/claw-validation-market
ADMIN_LOGIN_ID=admin \
ADMIN_LOGIN_PASSWORD=change_me \
PARTICIPANT_PRIVATE_KEY=0x... \
CHAIN_ID=10143 \
INTENT_BOOK_ADDRESS=0x... \
npm run smoke:all-apis -w @claw/relayer
```

Required env in relayer `.env`:
- `ADMIN_LOGIN_ID`
- `ADMIN_LOGIN_PASSWORD` (or `ADMIN_LOGIN_PASSWORD_HASH`)
- `CHAIN_ID`
- `INTENT_BOOK_ADDRESS`
- `RELAYER_SIGNER_PRIVATE_KEY`
- `CLAIM_THRESHOLD_WEIGHT`
- `INTENT_THRESHOLD_WEIGHT`
- `VERIFIER_WEIGHT_SNAPSHOT`
- `BOT_API_KEYS`, `BOT_SCOPES`

## 2) Import into Postman
1. Import collection: `Claw-Relayer-v0.postman_collection.json`
2. Import environment: `Claw-Relayer-local.postman_environment.json`
3. Select environment `Claw Relayer Local`
4. Fill bot API keys and base URL if needed
5. Set `admin_auth_cookie` from browser login session

## 3) Generate valid signatures for intent attestation endpoint
`POST /intents/attestations/batch` requires valid EIP-712 signatures.

```bash
cd /Users/ham-yunsig/Documents/github/claw-validation-market/packages/relayer
export CHAIN_ID=10143
export INTENT_BOOK_ADDRESS=0x0000000000000000000000000000000000000102
export PARTICIPANT_PRIVATE_KEY=0xYOUR_PRIVATE_KEY
node ./postman/generate-attestation-fixtures.mjs
```

This generates:
- `postman/fixtures/intent-attestation-batch.json`

And prints Postman environment values to copy:
- `participant_address`, `intent_signature`, etc.

## 4) Recommended run order
1. Sign in at `/login` and set `admin_auth_cookie` in Postman
2. `POST /api/v1/funds` (admin creates fund metadata only)
   - includes `strategyBotId` + `strategyBotAddress` (single strategy bot for fund)
3. `POST /api/v1/funds/bootstrap` (admin deploys onchain fund stack + persists deployment metadata)
4. `POST /api/v1/funds/{fundId}/bots/register` (strategy bot registers participant bot)
5. `GET /api/v1/funds/{fundId}/bots/register` (strategy bot verifies registry)
6. `POST /api/v1/funds/{fundId}/claims` (participant submits canonical claim payload)
7. `POST /api/v1/funds/{fundId}/epochs/{epochId}/aggregate` (strategy aggregates epoch state hash from submitted claims)
8. `GET /api/v1/funds/{fundId}/epochs/latest` (read latest epoch state hash for intent input)
9. `POST /api/v1/funds/{fundId}/intents/propose` (strategy proposes intent with required `executionRoute`)
10. `POST /api/v1/funds/{fundId}/intents/attestations/batch` (participant attests intent)
11. `POST /api/v1/cron/execute-intents` (execution worker tick)
12. `GET /api/v1/executions` and re-check `GET /api/v1/funds/{fundId}/status`, `GET /api/v1/metrics`

## Notes
- Admin endpoints require NextAuth admin-id session; collection includes `admin_auth_cookie` placeholder.
- Get admin cookie by signing in at `/login` with `ADMIN_LOGIN_ID` / password, then copy browser cookie into Postman.
- Participant bot registration endpoint is strategy-only (`bots.register` scope).
- For weighted intent threshold, the signer address must be present in `VERIFIER_WEIGHT_SNAPSHOT` with positive weight.
- `POST /intents/propose` does not accept direct `allowlistHash`; relayer computes it from `executionRoute` only.
- Legacy endpoints `POST /attestations`, `GET /snapshots/latest`, `GET /events/claims` are removed (404).
- Collection now includes `funds/bootstrap`, `executions`, `cron/execute-intents`, and SSE endpoint (`events/intents`).
- If you only want quick negative-path testing, use the `bad signature` requests in the collection.
