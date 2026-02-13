# openfunderse

Install OpenFunderse skill packs into Codex.

## Usage

```bash
# list bundled packs
npx @wiimdy/openfunderse@latest list

# install pack into ~/.codex/skills
npx @wiimdy/openfunderse@latest install openfunderse

# install into custom codex home
npx @wiimdy/openfunderse@latest install openfunderse --codex-home /custom/.codex
```

## Notes

- Skills are copied into `$CODEX_HOME/skills` (default `~/.codex/skills`).
- Pack metadata/prompts are copied into `$CODEX_HOME/packs/<pack-name>`.
- Use `--force` to overwrite existing installed skills.
