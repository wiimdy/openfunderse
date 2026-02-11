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

: "${RPC_URL:?RPC_URL is required in .env}"
: "${CHAIN_ID:?CHAIN_ID is required in .env}"
: "${DEPLOYER_PRIVATE_KEY:?DEPLOYER_PRIVATE_KEY is required in .env}"
DEPLOYER_ADDRESS="$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")"

if ! cast chain-id --rpc-url "$RPC_URL" >/dev/null 2>&1; then
  if [[ "$RPC_URL" == http://127.0.0.1:* || "$RPC_URL" == http://localhost:* ]]; then
    echo "[deploy] no local RPC at $RPC_URL, starting anvil..."
    nohup anvil --host 127.0.0.1 --port 8545 --chain-id "$CHAIN_ID" >/tmp/openclaw-anvil.log 2>&1 &
    sleep 1
  else
    echo "[deploy] RPC is unreachable: $RPC_URL"
    exit 1
  fi
fi

# Local anvil convenience: ensure deployer has enough gas balance.
if [[ "$RPC_URL" == http://127.0.0.1:* || "$RPC_URL" == http://localhost:* ]]; then
  cast rpc --rpc-url "$RPC_URL" anvil_setBalance "$DEPLOYER_ADDRESS" 0x3635C9ADC5DEA00000 >/dev/null 2>&1 || true
fi

echo "[deploy] running forge script..."
cd "$CONTRACTS_DIR"
OUT_FILE="/tmp/intentbook-deploy.out"
forge script script/DeployIntentBook.s.sol:DeployIntentBookScript \
  --rpc-url "$RPC_URL" \
  --broadcast | tee "$OUT_FILE"

RUN_JSON="$CONTRACTS_DIR/broadcast/DeployIntentBook.s.sol/$CHAIN_ID/run-latest.json"
SNAPSHOT_BOOK_ADDRESS="$(jq -r '.transactions[] | select(.contractName=="MockSnapshotBook" and .transactionType=="CREATE") | .contractAddress' "$RUN_JSON" | tail -n1)"
INTENT_BOOK_ADDRESS="$(jq -r '.transactions[] | select(.contractName=="IntentBook" and .transactionType=="CREATE") | .contractAddress' "$RUN_JSON" | tail -n1)"
SNAPSHOT_HASH="$(jq -r '.transactions[] | select(.contractName=="MockSnapshotBook" and .function=="setFinalized(bytes32,bool)") | .arguments[0]' "$RUN_JSON" | tail -n1)"

if [[ -z "$SNAPSHOT_BOOK_ADDRESS" || -z "$INTENT_BOOK_ADDRESS" ]]; then
  echo "[deploy] failed to parse deployment addresses"
  exit 1
fi

cat > "$DEPLOY_ENV_FILE" <<ENV
INTENT_BOOK_ADDRESS=$INTENT_BOOK_ADDRESS
SNAPSHOT_BOOK_ADDRESS=$SNAPSHOT_BOOK_ADDRESS
DEFAULT_SNAPSHOT_HASH=$SNAPSHOT_HASH
ENV

echo "[deploy] wrote $DEPLOY_ENV_FILE"
cat "$DEPLOY_ENV_FILE"
