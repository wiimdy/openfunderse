#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[demo-local] starting local happy-path scaffold check"

if [[ ! -f .env ]]; then
  echo "[demo-local] .env not found. Copying from .env.example"
  cp .env.example .env
fi

echo "[demo-local] step 1/4: contracts compile (Foundry)"
if command -v forge >/dev/null 2>&1; then
  (cd packages/contracts && forge build)
else
  echo "[demo-local] forge not found; skipping compile"
fi

echo "[demo-local] step 2/4: relayer/agents smoke run (indexer deferred)"
node packages/relayer/scripts/local-smoke.mjs
node packages/agents/scripts/local-smoke.mjs

echo "[demo-local] step 3/4: monorepo package check"
test -f package.json
test -f packages/sdk/package.json
test -f packages/relayer/package.json
test -f packages/indexer/package.json
test -f packages/agents/package.json

if [[ "${RUN_INDEXER:-0}" == "1" ]]; then
  echo "[demo-local] optional indexer smoke run enabled"
  node packages/indexer/scripts/local-smoke.mjs
fi

echo "[demo-local] step 4/4: done"
echo "[demo-local] local happy-path scaffold is ready"
