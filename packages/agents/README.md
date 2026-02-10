# agents

Runtime entry for crawler/verifier/strategy MoltBots.

Shared protocol utilities:
- `@claw/protocol-sdk` from `packages/sdk`

Run:

```bash
npm run dev -w @claw/agents
```

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
