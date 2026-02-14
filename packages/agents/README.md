# agents

Runtime entry for participant/strategy MoltBots.

ER2 quickstart:
- runbook: `packages/agents/ER2_RUNBOOK.md`
- strategy env template: `packages/agents/.env.strategy.example`
- participant env template: `packages/agents/.env.participant.example`
- legacy combined template: `packages/agents/.env.example`

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
- Owns participant claim/strategy intent runtime flows used by local smoke/E2E paths.

Shared protocol utilities:
- `@claw/protocol-sdk` from `packages/sdk`

Run:

```bash
npm run dev -w @claw/agents
```

## Participant claim model (allocation only)

Participant claim is `AllocationClaimV1`:
- input: `targetWeights[]`, `horizonSec`, `nonce`
- canonical hash: SDK `buildCanonicalAllocationClaimRecord`
- no crawl/source/evidence payload in v0 claim model

## Wave A runtime env (relayer client + signer)

Relayer client:
- `RELAYER_URL`
- `BOT_ID`
- `BOT_API_KEY`
- `BOT_ADDRESS` (required for claim submit; must match registered participant bot address)

Signer:
- `PARTICIPANT_PRIVATE_KEY`
- `CHAIN_ID`
- `INTENT_BOOK_ADDRESS` (required only for intent attestation signing)

Participant submit safety:
- `PARTICIPANT_AUTO_SUBMIT` (`false` by default)
- `PARTICIPANT_REQUIRE_EXPLICIT_SUBMIT` (`true` by default)
- optional host allowlist: `PARTICIPANT_TRUSTED_RELAYER_HOSTS=relayer.example.com`
- local dev only: `PARTICIPANT_ALLOW_HTTP_RELAYER=true`

Participant optional scoped env:
- `PARTICIPANT_BOT_ID`, `PARTICIPANT_BOT_API_KEY`, `PARTICIPANT_BOT_ADDRESS`
- if omitted, participant flow uses `BOT_ID`, `BOT_API_KEY`, `BOT_ADDRESS`

Strategy signer env:
- `STRATEGY_PRIVATE_KEY`
- `STRATEGY_AUTO_SUBMIT` (`false` by default)
- `STRATEGY_REQUIRE_EXPLICIT_SUBMIT` (`true` by default)
- optional host allowlist: `STRATEGY_TRUSTED_RELAYER_HOSTS=relayer.example.com`
- local dev only: `STRATEGY_ALLOW_HTTP_RELAYER=true`
- `CLAW_FUND_FACTORY_ADDRESS`
- `INTENT_BOOK_ADDRESS`, `CLAW_CORE_ADDRESS`
- `NADFUN_EXECUTION_ADAPTER_ADDRESS` (fallback: `ADAPTER_ADDRESS`)
- optional preflight: `STRATEGY_CREATE_MIN_SIGNER_BALANCE_WEI`

## Participant commands

```bash
# 1) Mine allocation claim
npm run participant:mine -w @claw/agents -- \
  --fund-id demo-fund \
  --epoch-id 1 \
  --target-weights 7000,3000 \
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
  --target-weights 7000,3000 \
  --report-file /tmp/participant-e2e-report.json \
  --submit
```

Default participant safety behavior:
- `PARTICIPANT_REQUIRE_EXPLICIT_SUBMIT=true` and no `--submit` => `decision: "READY"` (no relayer transmission)
- `--submit` but `PARTICIPANT_AUTO_SUBMIT=false` => fail-closed with `SAFETY_BLOCKED`

## Strategy commands (EOA signer)

```bash
# 0) Copy deploy config template and edit values
cp packages/agents/config/deploy-config.template.json /tmp/deploy-config.json

# 0) Create fund directly onchain via Factory (dry-run only)
npm run strategy:create:fund -w @claw/agents -- \
  --fund-id demo-fund-001 \
  --fund-name "Demo Fund 001" \
  --deploy-config-file /absolute/path/to/deploy-config.json

# 0-1) Submit createFund onchain + sync deployment metadata to relayer
npm run strategy:create:fund -w @claw/agents -- \
  --fund-id demo-fund-001 \
  --fund-name "Demo Fund 001" \
  --deploy-config-file /absolute/path/to/deploy-config.json \
  --telegram-room-id -1001234567890 \
  --submit

# 1) READY_FOR_ONCHAIN intent attestation submit (IntentBook.attestIntent via signer tx)
npm run strategy:attest:onchain -w @claw/agents -- \
  --fund-id demo-fund \
  --intent-hash 0x...

# 2) READY execution jobs submit (ClawCore.executeIntent via signer tx)
npm run strategy:execute:ready -w @claw/agents -- \
  --fund-id demo-fund \
  --limit 10

# 3) Dry-run intent execution against core
npm run strategy:dry-run:intent -w @claw/agents -- \
  --intent-hash 0x... \
  --intent-file /tmp/intent.json \
  --execution-route-file /tmp/route.json
```

### `deploy-config.json` location and schema

The repository now includes a starter template:

- `packages/agents/config/deploy-config.template.json`

`strategy-create-fund` requires one of:

- `--deploy-config-file <path>`
- `--deploy-config-json '<json>'`

Copy the template and update values:

```bash
cp packages/agents/config/deploy-config.template.json /tmp/deploy-config.json
```

Field guide:

- `fundOwner` (required): final owner of the fund.
- `strategyAgent` (optional): strategy bot address. if omitted, CLI fallback is `--strategy-bot-address` or `BOT_ADDRESS`.
- `snapshotBook` (required): deployed snapshot book address.
- `asset` (required): vault asset token (for Monad testnet usually WMON).
- `vaultName` / `vaultSymbol` (required): ERC4626 metadata.
- `intentThresholdWeight` (required): total verifier weight required for intent approval.
- `nadfunLens` (optional): NadFun lens address (`0x000...0000` allowed).
- `initialVerifiers` + `initialVerifierWeights` (required together): same length, each weight must be positive.
- `initialAllowedTokens` (optional): allowlist for tradable tokens.
- `initialAllowedAdapters` (optional): allowlist for execution adapters. use your deployed NadFun adapter address.

## Strategy skill guarded submit

Programmatic skill path builds proposal first, then submits only when submit gates are explicitly enabled.

1. build strategy decision (`proposeIntent`)
2. if `submit=true` and `STRATEGY_AUTO_SUBMIT=true`, submit canonical intent to relayer (`POST /intents/propose`)
3. if step 2 passed, send onchain `IntentBook.proposeIntent` via strategy signer tx

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
