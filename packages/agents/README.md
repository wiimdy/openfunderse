# agents

Runtime entry for crawler/verifier/strategy MoltBots.

## Role
- Monorepo bot runtime package (execution code), not installer/distribution.
- Owns crawl/verify/propose runtime flows used by local smoke/E2E paths.

Shared protocol utilities:
- `@claw/protocol-sdk` from `packages/sdk`

Run:

```bash
npm run dev -w @claw/agents
```

## Reddit MVP: Data Mining + Verification

MVP baseline source is Reddit (no API key required):
- crawler mines keyword stats from `r/<subreddit>/new.json`
- verifier re-crawls the mined post ids via `by_id` and checks deterministic match

Commands:

```bash
# 1) mine claim + save evidence/claim bundle
npm run crawl:reddit -w @claw/agents -- \
  --subreddit CryptoCurrency \
  --keywords monad,airdrop \
  --limit 25

# 2) verify an existing claim bundle
npm run verify:reddit -w @claw/agents -- \
  --claim /absolute/path/to/*.claim.json

# 3) one-shot mvp flow (crawl -> verify)
npm run flow:reddit -w @claw/agents -- \
  --subreddit CryptoCurrency \
  --keywords monad,airdrop \
  --limit 25
```

Generated files are stored in:
- `packages/agents/data/claims/*.claim.json`
- `packages/agents/data/claims/*.evidence.json`
- `packages/agents/data/claims/*.verification.json`

Optional env:
- `CRAWLER_ADDRESS=0x...`
- `REDDIT_USER_AGENT=openclaw-mvp-crawler/0.1`

## Wave A runtime env (relayer client + signer)

Relayer client:
- `RELAYER_URL`
- `BOT_ID`
- `BOT_API_KEY`
- `BOT_ADDRESS` (required for claim submit; must match registered crawler/verifier bot address)

Signer:
- `BOT_PRIVATE_KEY` or `VERIFIER_PRIVATE_KEY`
- `CHAIN_ID`
- `CLAIM_ATTESTATION_VERIFIER_ADDRESS` (preferred)
- `CLAIM_BOOK_ADDRESS` (fallback for claim attest domain)
- `INTENT_BOOK_ADDRESS` (required only for intent attestation signing)

Participant source safety:
- `PARTICIPANT_ALLOWED_SOURCE_HOSTS=www.reddit.com,api.coingecko.com`
- `PARTICIPANT_MAX_RESPONSE_BYTES=524288`
- `PARTICIPANT_ALLOW_HTTP_SOURCE=true` (local dev only)

Role-split env for participant e2e:
- `CRAWLER_BOT_ID`, `CRAWLER_BOT_API_KEY`, `CRAWLER_BOT_ADDRESS`
- `VERIFIER_BOT_ID`, `VERIFIER_BOT_API_KEY`, `VERIFIER_BOT_ADDRESS`
- `VERIFIER_PRIVATE_KEY`

Strategy AA env:
- `STRATEGY_AA_BUNDLER_URL`
- `STRATEGY_AA_USER_OP_VERSION` (`v06` or `v07`)
- `STRATEGY_AA_ENTRYPOINT_ADDRESS`
- `STRATEGY_AA_ACCOUNT_ADDRESS`
- `STRATEGY_AA_OWNER_PRIVATE_KEY` (or `STRATEGY_PRIVATE_KEY`)
- `INTENT_BOOK_ADDRESS`, `CLAW_CORE_ADDRESS`
- optional tuning: `STRATEGY_AA_CALL_GAS_LIMIT`, `STRATEGY_AA_VERIFICATION_GAS_LIMIT`, `STRATEGY_AA_PRE_VERIFICATION_GAS`, `STRATEGY_AA_MAX_PRIORITY_FEE_PER_GAS`, `STRATEGY_AA_MAX_FEE_PER_GAS`

Monad testnet reference values:
- public bundler: `https://public.pimlico.io/v2/10143/rpc`
- `v06` + EntryPoint `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789`
- `v07` + EntryPoint `0x0000000071727De22E5E9d8BAf0edAc6f37da032` (when your bundler supports packed UserOp)

## Participant commands

```bash
# 1) Mine a claim from source URL
npm run participant:mine -w @claw/agents -- \
  --fund-id demo-fund \
  --epoch-id 1 \
  --source-ref https://www.reddit.com/r/CryptoCurrency/new.json?limit=10&raw_json=1 \
  --token-address 0x0000000000000000000000000000000000000001 \
  --out-file /tmp/participant-mine.json

# 2) Verify mined claim
npm run participant:verify -w @claw/agents -- \
  --claim-file /tmp/participant-mine.json \
  --max-data-age-seconds 300

# 3) Submit mined claim to relayer
npm run participant:submit -w @claw/agents -- \
  --claim-file /tmp/participant-mine.json

# 4) Attest submitted claim
npm run participant:attest -w @claw/agents -- \
  --fund-id demo-fund \
  --epoch-id 1 \
  --claim-hash 0x...

# 5) One-shot e2e (mine -> verify -> submit -> attest)
npm run participant:e2e -w @claw/agents -- \
  --fund-id demo-fund \
  --epoch-id 1 \
  --source-ref https://www.reddit.com/r/CryptoCurrency/new.json?limit=10&raw_json=1 \
  --token-address 0x0000000000000000000000000000000000000001 \
  --report-file /tmp/participant-e2e-report.json
```

## Strategy commands (AA)

```bash
# 1) READY_FOR_ONCHAIN intent attestation submit (IntentBook.attestIntent via UserOp)
npm run strategy:attest:onchain -w @claw/agents -- \
  --fund-id demo-fund \
  --intent-hash 0x...

# 2) READY execution jobs submit (ClawCore.executeIntent via UserOp)
npm run strategy:execute:ready -w @claw/agents -- \
  --fund-id demo-fund \
  --limit 10
```

Implemented modules:
- `/Users/wiimdy/agent/packages/agents/src/lib/relayer-client.ts`
- `/Users/wiimdy/agent/packages/agents/src/lib/signer.ts`

## Install-pack canonical source
Target onboarding UX:

```bash
npx @wiimdy/openfunderse@latest install openfunderse
```

Canonical pack files are maintained at:
- `packages/openfunderse/packs/openfunderse/config/setup-manifest.json`
- `packages/openfunderse/packs/openfunderse/skills/strategy/SKILL.md`
- `packages/openfunderse/packs/openfunderse/skills/participant/SKILL.md`
- `packages/openfunderse/packs/openfunderse/skills/relayer/SKILL.md`
- `packages/openfunderse/packs/openfunderse/prompts/strategy/system.md`
- `packages/openfunderse/packs/openfunderse/prompts/participant/system.md`
- `packages/openfunderse/packs/openfunderse/prompts/relayer/system.md`

`packages/agents` keeps runtime code only (`src/*`, `dist/*`).

Prompt references from docs:
- `docs/jupyter-notebook/openclaw-agent-prompt-book.ipynb`
- `docs/prompts/kr/base_system.md`
- `docs/prompts/kr/participant_moltbot.md`
- `docs/prompts/kr/strategy_moltbot.md`
- `docs/prompts/kr/relayer_next_server.md`
