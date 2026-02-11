#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CONTRACTS_DIR="$ROOT_DIR/packages/contracts"
DEPLOY_ENV_FILE="$CONTRACTS_DIR/.intentbook.local.env"

if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  source "$ROOT_DIR/.env"
  set +a
fi

if [[ -f "$DEPLOY_ENV_FILE" ]]; then
  set -a
  source "$DEPLOY_ENV_FILE"
  set +a
fi

: "${RPC_URL:?RPC_URL is required in .env}"
: "${DEPLOYER_PRIVATE_KEY:?DEPLOYER_PRIVATE_KEY is required in .env}"

if ! cast chain-id --rpc-url "$RPC_URL" >/dev/null 2>&1; then
  if [[ "$RPC_URL" == http://127.0.0.1:* || "$RPC_URL" == http://localhost:* ]]; then
    echo "[test] local RPC is not running. deploying local contracts (this starts anvil if needed)..."
    "$CONTRACTS_DIR/scripts/deploy-intentbook-local.sh"
    set -a
    source "$DEPLOY_ENV_FILE"
    set +a
  else
    echo "[test] RPC is unreachable: $RPC_URL"
    exit 1
  fi
fi

if [[ -z "${INTENT_BOOK_ADDRESS:-}" || -z "${SNAPSHOT_BOOK_ADDRESS:-}" ]]; then
  echo "[test] missing deployment addresses. deploying first..."
  "$CONTRACTS_DIR/scripts/deploy-intentbook-local.sh"
  set -a
  source "$DEPLOY_ENV_FILE"
  set +a
fi

if [[ "$(cast code "$INTENT_BOOK_ADDRESS" --rpc-url "$RPC_URL")" == "0x" ]]; then
  echo "[test] deployment not found on current RPC. redeploying..."
  "$CONTRACTS_DIR/scripts/deploy-intentbook-local.sh"
  set -a
  source "$DEPLOY_ENV_FILE"
  set +a
fi

cd "$CONTRACTS_DIR"
forge script script/ExerciseIntentBookMethods.s.sol:ExerciseIntentBookMethodsScript \
  --rpc-url "$RPC_URL" \
  --broadcast
