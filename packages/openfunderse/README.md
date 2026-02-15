# openfunderse

Install OpenFunderse split skill packs (`strategy`, `participant`) for OpenClaw/Codex.

## Quick Start

```bash
# 1) install skill + runtime
npx @wiimdy/openfunderse@2.0.0 install openfunderse-strategy --with-runtime
# or
npx @wiimdy/openfunderse@2.0.0 install openfunderse-participant --with-runtime

# 2) (optional) create/rotate bot wallet and update existing env
# If you already have keys, set *_PRIVATE_KEY and *_ADDRESS directly; you do not need bot-init.
npx @wiimdy/openfunderse@2.0.0 bot-init --skill-name strategy --yes --no-restart-openclaw-gateway
# or
npx @wiimdy/openfunderse@2.0.0 bot-init --skill-name participant --yes --no-restart-openclaw-gateway

# 3) (optional) load env in current shell
# @wiimdy/openfunderse-agents auto-loads env files from the workspace cwd by command role.
set -a; source ~/.openclaw/workspace/.env.strategy; set +a
# or
set -a; source ~/.openclaw/workspace/.env.participant; set +a
```

By default, `install` and `bot-init` also sync env keys into OpenClaw config (`~/.openclaw/openclaw.json > env.vars`).
Disable this with `--no-sync-openclaw-env`.

When `bot-init` syncs env keys into OpenClaw config, it also runs `openclaw gateway restart` to apply updates.
Disable this with `--no-restart-openclaw-gateway`.

## Telegram Slash Commands

After runtime install, `@wiimdy/openfunderse-agents` accepts slash commands:

- Strategy: `/propose_intent`, `/dry_run_intent`, `/attest_intent`, `/execute_intent`, `/create_fund`
- Participant: `/propose_allocation`, `/submit_allocation`, `/deposit`, `/withdraw`, `/redeem`, `/vault_info`

Underscore and `key=value` arguments are supported (for example: `fund_id=demo-fund`).
On first install, the CLI also prints a ready-to-paste `@BotFather` `/setcommands` block.
Telegram credentials (bot token/webhook) are configured at the OpenClaw gateway layer, not in these packs.

## Where Files Are Stored

- In OpenClaw, skills are installed under `~/.openclaw/workspace/skills`.
- Pack metadata is stored under `~/.openclaw/workspace/packs/<pack-name>`.
- Wallet backups from `bot-init` are stored under `~/.openclaw/workspace/openfunderse/wallets`.

## Important Notes

- Use only:
  - `openfunderse-strategy`
  - `openfunderse-participant`
- Default env scaffold path is role-based under OpenClaw workspace:
  - strategy: `~/.openclaw/workspace/.env.strategy`
  - participant: `~/.openclaw/workspace/.env.participant`
- `bot-init` updates an existing role env file. If missing, create it first (or run `install` without `--no-init-env`).
- `bot-init` generates a new wallet for the role (private key + address) and writes it into the role env file.
- Use `--env-path` only when you want a custom filename/location.
