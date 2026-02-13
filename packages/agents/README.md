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
