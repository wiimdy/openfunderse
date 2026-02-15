#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CONTRACTS_DIR="$ROOT/packages/contracts"

if [[ -f "$ROOT/.env" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" != *=* ]] && continue
    key="${line%%=*}"
    value="${line#*=}"
    key="$(echo "$key" | xargs)"
    if [[ -z "${!key:-}" ]]; then
      export "$key=$value"
    fi
  done < "$ROOT/.env"
fi

: "${RPC_URL:?RPC_URL is required}"
: "${DEPLOYER_PRIVATE_KEY:?DEPLOYER_PRIVATE_KEY is required}"

cd "$CONTRACTS_DIR"

VERIFY_FLAGS=""
if [[ -n "${SCAN_API_KEY:-}" ]]; then
  VERIFY_FLAGS="--verify --etherscan-api-key $SCAN_API_KEY"
fi

forge script script/DeployClawFundFactory.s.sol:DeployClawFundFactory \
  --rpc-url "$RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast \
  $VERIFY_FLAGS
