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
: "${INTENT_BOOK_ADDRESS:?INTENT_BOOK_ADDRESS is required}"
: "${NADFUN_WMON_ADDRESS:?NADFUN_WMON_ADDRESS is required}"
: "${NADFUN_BONDING_CURVE_ROUTER:?NADFUN_BONDING_CURVE_ROUTER is required}"
: "${NADFUN_DEX_ROUTER:?NADFUN_DEX_ROUTER is required}"

cd "$CONTRACTS_DIR"

forge script script/DeployClawCoreStack.s.sol:DeployClawCoreStack \
  --rpc-url "$RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast

CHAIN_ID="$(cast chain-id --rpc-url "$RPC_URL")"
RUN_JSON="$CONTRACTS_DIR/broadcast/DeployClawCoreStack.s.sol/$CHAIN_ID/run-latest.json"

if [[ ! -f "$RUN_JSON" ]]; then
  echo "[deploy] run-latest.json not found: $RUN_JSON" >&2
  exit 1
fi

PROXY_ADDRESSES=()
while IFS= read -r addr; do
  [[ -n "$addr" ]] || continue
  PROXY_ADDRESSES+=("$addr")
done < <(
  jq -r '.transactions[]
    | select(.transactionType=="CREATE" and .contractName=="ERC1967Proxy")
    | .contractAddress' "$RUN_JSON"
)

# DeployClawCoreStack.s.sol deploy order:
# 1) Vault proxy, 2) Core proxy, 3) Adapter proxy
if [[ "${#PROXY_ADDRESSES[@]}" -lt 3 ]]; then
  echo "[deploy] expected at least 3 ERC1967Proxy deployments, got ${#PROXY_ADDRESSES[@]}" >&2
  exit 1
fi

VAULT_ADDRESS="${PROXY_ADDRESSES[0]}"
CORE_ADDRESS="${PROXY_ADDRESSES[1]}"
ADAPTER_ADDRESS="${PROXY_ADDRESSES[2]}"

for addr in "$VAULT_ADDRESS" "$CORE_ADDRESS" "$ADAPTER_ADDRESS"; do
  if [[ ! "$addr" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
    echo "[deploy] invalid proxy address parsed: $addr" >&2
    exit 1
  fi
done

OUT_ENV="$CONTRACTS_DIR/.clawcore.deploy.env"
cat > "$OUT_ENV" <<ENV
VAULT_ADDRESS=$VAULT_ADDRESS
CORE_ADDRESS=$CORE_ADDRESS
ADAPTER_ADDRESS=$ADAPTER_ADDRESS
ENV

echo "[deploy] wrote $OUT_ENV"
cat "$OUT_ENV"
