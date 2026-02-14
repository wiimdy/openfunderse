# openfunderse

Install OpenFunderse skill packs into Codex.

## Role
- Monorepo distribution package for Codex skills/prompts/manifests.
- Owns install UX (`npx @wiimdy/openfunderse@latest install openfunderse`) and pack copy logic.

## Usage

```bash
# list bundled packs
npx @wiimdy/openfunderse@latest list

# install pack into ~/.codex/skills
npx @wiimdy/openfunderse@latest install openfunderse

# install pack + runtime package in one command (recommended)
npx @wiimdy/openfunderse@latest install openfunderse --with-runtime

# install pack + runtime + strategy env scaffold in one command
npx @wiimdy/openfunderse@latest install openfunderse \
  --with-runtime \
  --init-env \
  --env-profile strategy

# install into custom codex home
npx @wiimdy/openfunderse@latest install openfunderse --codex-home /custom/.codex

# install runtime into a specific project directory
npx @wiimdy/openfunderse@latest install openfunderse \
  --with-runtime \
  --runtime-dir /path/to/project

# initialize bot env + fresh Monad wallet (strategy)
npx @wiimdy/openfunderse@latest bot-init \
  --skill-name strategy \
  --env-path .env.strategy

# initialize participant bot env + wallet
npx @wiimdy/openfunderse@latest bot-init \
  --skill-name participant \
  --env-path .env.participant
```

## Notes

- Skills are copied into `$CODEX_HOME/skills` (default `~/.codex/skills`).
- Pack metadata/prompts are copied into `$CODEX_HOME/packs/<pack-name>`.
- Use `--force` to overwrite existing installed skills.
- `--with-runtime` installs `@wiimdy/openfunderse-agents` into the current project (`package.json` required).
- `--init-env` generates editable env scaffold (default: `.env.openfunderse`).
- `--env-profile` controls scaffold scope: `strategy` | `participant` | `all`.
- `--env-path` sets a custom env scaffold path.
- Optional: `--runtime-package`, `--runtime-dir`, `--runtime-manager`.
- Default unified bundle is `clawbot-core` (strategy + participant role actions).
- Prefer `--env-path` (Node 20+ reserves `--env-file` as a runtime flag).
- `bot-init` uses `cast wallet new --json` (Foundry) to generate a new wallet for Monad testnet.
- `bot-init` infers role from `--skill-name`, `--env-path`, or `--wallet-name` when `--role` is omitted.
- It also infers from active skill env hints (`OPENCLAW_SKILL_KEY`, `OPENCLAW_ACTIVE_SKILL`, `SKILL_KEY`, `SKILL_NAME`).
- `bot-init` writes role-specific key fields:
  - `strategy`: `STRATEGY_PRIVATE_KEY`, `BOT_ADDRESS`
  - `participant`: `PARTICIPANT_PRIVATE_KEY`, `PARTICIPANT_BOT_ADDRESS`, `BOT_ADDRESS`
- `bot-init` stores a wallet backup JSON under `$CODEX_HOME/openfunderse/wallets`.
- If private key already exists in the target env file, `bot-init` requires `--force` to rotate.
- CLI cannot mutate your parent shell env directly; run the printed `set -a; source ...; set +a` command.
