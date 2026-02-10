# Relayer Postman Kit

This folder contains ready-to-import Postman assets for local Relayer/Aggregator v0 testing (SQLite mode).

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

Required env in relayer `.env`:
- `ADMIN_LOGIN_ID`
- `ADMIN_LOGIN_PASSWORD` (or `ADMIN_LOGIN_PASSWORD_HASH`)
- `CHAIN_ID`
- `CLAIM_BOOK_ADDRESS`
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

## 3) Generate valid signatures for attestation endpoints
`POST /attestations` and `POST /intents/attestations/batch` require valid EIP-712 signatures.

```bash
cd /Users/ham-yunsig/Documents/github/claw-validation-market/packages/relayer
export CHAIN_ID=10143
export CLAIM_BOOK_ADDRESS=0x0000000000000000000000000000000000000101
export INTENT_BOOK_ADDRESS=0x0000000000000000000000000000000000000102
export VERIFIER_PRIVATE_KEY=0xYOUR_PRIVATE_KEY
node ./postman/generate-attestation-fixtures.mjs
```

This generates:
- `postman/fixtures/claim-attestation.json`
- `postman/fixtures/intent-attestation-batch.json`

And prints Postman environment values to copy:
- `verifier_address`, `claim_signature`, `intent_signature`, etc.

## 4) Recommended run order
1. Sign in at `/login` and set `admin_auth_cookie` in Postman
2. `POST /api/v1/funds` (admin creates fund)
   - includes `strategyBotId` + `strategyBotAddress` (single strategy bot for fund)
3. `POST /api/v1/funds/{fundId}/bots/register` (strategy bot registers participant bot)
4. `GET /api/v1/funds/{fundId}/bots/register` (strategy bot verifies registry)
5. `POST /api/v1/funds/{fundId}/attestations` (valid claim signature)
6. `POST /api/v1/funds/{fundId}/intents/attestations/batch` (valid intent signature)
7. Re-check `GET /api/v1/funds/{fundId}/status` and `GET /api/v1/metrics`

## Notes
- Admin endpoints require NextAuth admin-id session; collection includes `admin_auth_cookie` placeholder.
- Get admin cookie by signing in at `/login` with `ADMIN_LOGIN_ID` / password, then copy browser cookie into Postman.
- Participant bot registration endpoint is strategy-only (`bots.register` scope).
- For weighted pass condition, the signer address must be present in `VERIFIER_WEIGHT_SNAPSHOT` with positive weight.
- If you only want quick negative-path testing, use the `bad signature` requests in the collection.
