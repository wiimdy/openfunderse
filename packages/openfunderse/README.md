# openfunderse

Install OpenFunderse skill packs into OpenClaw.

## Role
- Monorepo distribution package for Codex skills/prompts/manifests.
- Owns install UX (`npx @wiimdy/openfunderse@latest install openfunderse`) and pack copy logic.

## Usage

```bash
# list bundled packs
npx @wiimdy/openfunderse@latest list

# install pack into ~/.openclaw/skills
npx @wiimdy/openfunderse@latest install openfunderse

# install pack as symlinks (good for local development / fast updates)
npx @wiimdy/openfunderse@latest install openfunderse --link

# install pack + runtime package in one command (recommended)
npx @wiimdy/openfunderse@latest install openfunderse --with-runtime

# install into custom OpenClaw home
npx @wiimdy/openfunderse@latest install openfunderse --openclaw-home /custom/.openclaw

# install runtime into a specific project directory
npx @wiimdy/openfunderse@latest install openfunderse \
  --with-runtime \
  --runtime-dir /path/to/project
```

## Notes

- Skills are copied into `$OPENCLAW_HOME/skills` (default `~/.openclaw/skills`).
- `--link` installs skills as symlinks from `$OPENCLAW_HOME/packs/<pack-name>/skills/*` into `$OPENCLAW_HOME/skills/*`.
- Pack metadata/prompts are copied into `$OPENCLAW_HOME/packs/<pack-name>`.
- Use `--force` to overwrite existing installed skills.
- `--with-runtime` installs `@wiimdy/openfunderse-agents` into the current project (`package.json` required).
- Optional: `--runtime-package`, `--runtime-dir`, `--runtime-manager`.
- Backward compatibility: `--codex-home` and `CODEX_HOME` are still accepted as aliases.
- Default unified bundle is `clawbot-core` (strategy + participant role actions).
- Installer prints each installed skill with its `SKILL.md` name/description so users can see what was added.
