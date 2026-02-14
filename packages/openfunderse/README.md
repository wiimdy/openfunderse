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

# install into custom codex home
npx @wiimdy/openfunderse@latest install openfunderse --codex-home /custom/.codex

# install runtime into a specific project directory
npx @wiimdy/openfunderse@latest install openfunderse \
  --with-runtime \
  --runtime-dir /path/to/project
```

## ClawHub Publish Script

```bash
# from repo root: publish both strategy + participant
bash ./packages/openfunderse/scripts/publish-clawhub-roles.sh --version 1.0.0

# publish only one role
bash ./packages/openfunderse/scripts/publish-clawhub-roles.sh --version 1.0.1 --only strategy

# preview publish commands only
bash ./packages/openfunderse/scripts/publish-clawhub-roles.sh --version 1.0.2 --dry-run
```

Or via npm workspace script:

```bash
npm run publish:clawhub:roles -w @wiimdy/openfunderse -- --version 1.0.0
```

## Notes

- Skills are copied into `$CODEX_HOME/skills` (default `~/.codex/skills`).
- Pack metadata/prompts are copied into `$CODEX_HOME/packs/<pack-name>`.
- Use `--force` to overwrite existing installed skills.
- `--with-runtime` installs `@wiimdy/openfunderse-agents` into the current project (`package.json` required).
- Optional: `--runtime-package`, `--runtime-dir`, `--runtime-manager`.
- Default unified bundle is `clawbot-core` (strategy + participant role actions).
- Publish helper script: `scripts/publish-clawhub-roles.sh`.
