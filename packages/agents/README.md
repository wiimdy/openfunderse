# agents

Runtime entry for participant/strategy MoltBots.

ER2 quickstart:
- runbook: `packages/agents/ER2_RUNBOOK.md`
- env template: `packages/agents/.env.er2.example`

Unified entrypoint:

```bash
npm run clawbot:run -w @claw/agents -- \
  --role strategy \
  --action propose_intent \
  --fund-id demo-fund \
  --intent-file /tmp/intent.json \
  --execution-route-file /tmp/route.json
```

One-command smoke:
```bash
npm run bot:smoke:e2e -w @claw/agents
```

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
- participant mines keyword stats from `r/<subreddit>/new.json`
- participant re-crawls the mined post ids via `by_id` and checks deterministic match

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
- `BOT_ADDRESS` (required for claim submit; must match registered participant bot address)

Signer:
- `BOT_PRIVATE_KEY` or `VERIFIER_PRIVATE_KEY`
- `CHAIN_ID`
- `INTENT_BOOK_ADDRESS` (required only for intent attestation signing)

Participant source safety:
- `PARTICIPANT_ALLOWED_SOURCE_HOSTS=www.reddit.com,api.coingecko.com`
- `PARTICIPANT_MAX_RESPONSE_BYTES=524288`
- `PARTICIPANT_ALLOW_HTTP_SOURCE=true` (local dev only)
- `PARTICIPANT_AUTO_SUBMIT` (`false` by default)
- `PARTICIPANT_REQUIRE_EXPLICIT_SUBMIT` (`true` by default)
- optional host allowlist: `PARTICIPANT_TRUSTED_RELAYER_HOSTS=relayer.example.com`
- local dev only: `PARTICIPANT_ALLOW_HTTP_RELAYER=true`

Participant optional scoped env:
- `PARTICIPANT_BOT_ID`, `PARTICIPANT_BOT_API_KEY`, `PARTICIPANT_BOT_ADDRESS`
- if omitted, participant flow uses `BOT_ID`, `BOT_API_KEY`, `BOT_ADDRESS`

Strategy AA env:
- `STRATEGY_AA_BUNDLER_URL`
- `STRATEGY_AA_USER_OP_VERSION` (`v06` or `v07`)
- `STRATEGY_AA_ENTRYPOINT_ADDRESS`
- `STRATEGY_AA_ACCOUNT_ADDRESS`
- `STRATEGY_AA_OWNER_PRIVATE_KEY` (or `STRATEGY_PRIVATE_KEY`)
- `STRATEGY_AUTO_SUBMIT` (`false` by default)
- `STRATEGY_REQUIRE_EXPLICIT_SUBMIT` (`true` by default)
- optional host allowlist: `STRATEGY_TRUSTED_RELAYER_HOSTS=relayer.example.com`
- local dev only: `STRATEGY_ALLOW_HTTP_RELAYER=true`
- `CLAW_FUND_FACTORY_ADDRESS`
- `INTENT_BOOK_ADDRESS`, `CLAW_CORE_ADDRESS`
- `NADFUN_EXECUTION_ADAPTER_ADDRESS` (fallback: `ADAPTER_ADDRESS`)
- optional preflight: `STRATEGY_CREATE_MIN_AA_BALANCE_WEI`
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
  --claim-file /tmp/participant-mine.json \
  --submit

# 4) One-shot e2e (mine -> verify -> submit)
npm run participant:e2e -w @claw/agents -- \
  --fund-id demo-fund \
  --epoch-id 1 \
  --source-ref https://www.reddit.com/r/CryptoCurrency/new.json?limit=10&raw_json=1 \
  --token-address 0x0000000000000000000000000000000000000001 \
  --report-file /tmp/participant-e2e-report.json \
  --submit
```

Default participant safety behavior:
- `PARTICIPANT_REQUIRE_EXPLICIT_SUBMIT=true` and no `--submit` => `decision: "READY"` (no relayer transmission)
- `--submit` but `PARTICIPANT_AUTO_SUBMIT=false` => fail-closed with `SAFETY_BLOCKED`

## Strategy commands (AA)

```bash
# 0) Create fund directly onchain via Factory (dry-run only)
npm run strategy:create:fund -w @claw/agents -- \
  --fund-id demo-fund-001 \
  --fund-name "Demo Fund 001" \
  --deploy-config-file /absolute/path/to/deploy-config.json

# 0-a) Set default strategy AA address in agents .env
npm run strategy:set:aa -w @claw/agents -- \
  --address 0xYourStrategySmartAccount

# 0-1) Submit createFund onchain + sync deployment metadata to relayer
npm run strategy:create:fund -w @claw/agents -- \
  --fund-id demo-fund-001 \
  --fund-name "Demo Fund 001" \
  --deploy-config-file /absolute/path/to/deploy-config.json \
  --telegram-room-id -1001234567890 \
  --submit

# 1) READY_FOR_ONCHAIN intent attestation submit (IntentBook.attestIntent via UserOp)
npm run strategy:attest:onchain -w @claw/agents -- \
  --fund-id demo-fund \
  --intent-hash 0x...

# 2) READY execution jobs submit (ClawCore.executeIntent via UserOp)
npm run strategy:execute:ready -w @claw/agents -- \
  --fund-id demo-fund \
  --limit 10

# 3) Dry-run intent execution against core
npm run strategy:dry-run:intent -w @claw/agents -- \
  --intent-hash 0x... \
  --intent-file /tmp/intent.json \
  --execution-route-file /tmp/route.json
```

## Strategy skill guarded submit

Programmatic skill path builds proposal first, then submits only when submit gates are explicitly enabled.

1. build strategy decision (`proposeIntent`)
2. if `submit=true` and `STRATEGY_AUTO_SUBMIT=true`, submit canonical intent to relayer (`POST /intents/propose`)
3. if step 2 passed, send onchain `IntentBook.proposeIntent` via strategy AA

```ts
import { proposeIntentAndSubmit } from '@claw/agents';

const out = await proposeIntentAndSubmit({
  taskType: 'propose_intent',
  fundId: 'demo-fund',
  roomId: '-1001234567890',
  epochId: 12,
  snapshot: {
    snapshotHash: '0x...',
    finalized: true,
    claimCount: 6
  },
  marketState: {
    network: 10143,
    nadfunCurveState: {},
    liquidity: {},
    volatility: {}
  },
  riskPolicy: {
    maxNotional: '1000000000000000000',
    maxSlippageBps: 500,
    allowlistTokens: ['0x...'],
    allowlistVenues: ['nadfun']
  },
  submit: true
});
```

Default safety behavior:
- `STRATEGY_REQUIRE_EXPLICIT_SUBMIT=true` and no `submit` => returns `decision: "READY"` (no relayer/onchain submission)
- `submit: true` but `STRATEGY_AUTO_SUBMIT=false` => throws fail-closed error

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
- `packages/openfunderse/packs/openfunderse/skills/clawbot-core/SKILL.md`
- `packages/openfunderse/packs/openfunderse/prompts/core/system.md`
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
