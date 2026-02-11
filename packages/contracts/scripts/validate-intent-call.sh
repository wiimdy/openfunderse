#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

: "${RPC_URL:?RPC_URL is required}"
: "${CLAW_CORE_ADDRESS:?CLAW_CORE_ADDRESS is required}"
: "${INTENT_HASH:?INTENT_HASH is required}"
: "${TOKEN_IN:?TOKEN_IN is required}"
: "${TOKEN_OUT:?TOKEN_OUT is required}"
: "${AMOUNT_IN:?AMOUNT_IN is required}"
: "${QUOTE_AMOUNT_OUT:?QUOTE_AMOUNT_OUT is required}"
: "${MIN_AMOUNT_OUT:?MIN_AMOUNT_OUT is required}"
: "${ADAPTER:?ADAPTER is required}"
: "${ADAPTER_DATA:?ADAPTER_DATA is required}"

cast call "$CLAW_CORE_ADDRESS" \
  "validateIntentExecution(bytes32,(address,address,uint256,uint256,uint256,address,bytes))((bool,bool,bool,bool,bool,bool,bool,bytes32,uint64,uint16,uint256,bytes32,bytes32))" \
  "$INTENT_HASH" \
  "($TOKEN_IN,$TOKEN_OUT,$AMOUNT_IN,$QUOTE_AMOUNT_OUT,$MIN_AMOUNT_OUT,$ADAPTER,$ADAPTER_DATA)" \
  --rpc-url "$RPC_URL"
