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

# 3) load env in current shell
set -a; source .env; set +a
```

## Where Files Are Stored

- In OpenClaw, skills are installed under `~/.openclaw/workspace/skills`.
- Pack metadata is stored under `~/.openclaw/workspace/packs/<pack-name>`.
- Wallet backups from `bot-init` are stored under `~/.openclaw/workspace/openfunderse/wallets`.

## Important Notes

- Use only:
  - `openfunderse-strategy`
  - `openfunderse-participant`
- Default env scaffold path is `.env`.
- If you run both bots in the same directory, use `--env-path` to split files (for example `.env.strategy`, `.env.participant`).
