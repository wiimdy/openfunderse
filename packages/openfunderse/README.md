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
```

## Notes

- Skills are copied into `$CODEX_HOME/skills` (default `~/.codex/skills`).
- Pack metadata/prompts are copied into `$CODEX_HOME/packs/<pack-name>`.
- Use `--force` to overwrite existing installed skills.
- `--with-runtime` installs `@wiimdy/openfunderse-agents` into the current project (`package.json` required).
- `--init-env` generates editable env scaffold (default: `.env.openfunderse`).
- `--env-profile` controls scaffold scope: `strategy` | `participant` | `all`.
- `--env-file` sets a custom env scaffold path.
- Optional: `--runtime-package`, `--runtime-dir`, `--runtime-manager`.
- Default unified bundle is `clawbot-core` (strategy + participant role actions).
