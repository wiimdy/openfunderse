# agents

Runtime entry for crawler/verifier/strategy MoltBots.

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

## Install-pack scaffold (TODO)
Target onboarding UX:

```bash
npx clawhub@latest install claw-validation-market
```

Scaffold files for future packaging are prepared at:
- `config/setup-manifest.json`
- `skills/strategy/SKILL.md`
- `skills/participant/SKILL.md`
- `skills/relayer/SKILL.md`
- `prompts/strategy/system.md`
- `prompts/participant/system.md`
- `prompts/relayer/system.md`

Prompt references from docs:
- `docs/jupyter-notebook/openclaw-agent-prompt-book.ipynb`
- `docs/prompts/kr/base_system.md`
- `docs/prompts/kr/participant_moltbot.md`
- `docs/prompts/kr/strategy_moltbot.md`
- `docs/prompts/kr/relayer_next_server.md`
