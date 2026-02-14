# openfunderse

Install OpenFunderse split skill packs (`strategy`, `participant`) for OpenClaw/Codex.

## Quick Start

```bash
# 1) install skill + runtime
npx @wiimdy/openfunderse@latest install openfunderse-strategy --with-runtime
# or
npx @wiimdy/openfunderse@latest install openfunderse-participant --with-runtime

# 2) create/rotate bot wallet and write env
npx @wiimdy/openfunderse@latest bot-init --skill-name strategy --yes
# or
npx @wiimdy/openfunderse@latest bot-init --skill-name participant --yes

# 3) (optional) load env in current shell
# @wiimdy/openfunderse-agents auto-loads .env.strategy / .env.participant by command role.
set -a; source .env.strategy; set +a
# or
set -a; source .env.participant; set +a
```

By default, `install` and `bot-init` also sync env keys into OpenClaw config (`~/.openclaw/openclaw.json > env.vars`).
Disable this with `--no-sync-openclaw-env`.

## Where Files Are Stored

- In OpenClaw, skills are installed under `~/.openclaw/workspace/skills`.
- Pack metadata is stored under `~/.openclaw/workspace/packs/<pack-name>`.
- Wallet backups from `bot-init` are stored under `~/.openclaw/workspace/openfunderse/wallets`.

## Important Notes

- Use only:
  - `openfunderse-strategy`
  - `openfunderse-participant`
- Default env scaffold path is role-based:
  - strategy: `.env.strategy`
  - participant: `.env.participant`
- Use `--env-path` only when you want a custom filename/location.
