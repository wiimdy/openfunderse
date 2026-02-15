#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CONTRACTS_DIR="$ROOT/packages/contracts"
SDK_DIR="$ROOT/packages/sdk"

if [[ -f "$CONTRACTS_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$CONTRACTS_DIR/.env"
  set +a
fi

: "${RPC_URL:?RPC_URL is required}"
: "${DEPLOYER_PRIVATE_KEY:?DEPLOYER_PRIVATE_KEY is required}"
: "${NADFUN_TARGET_TOKEN:?NADFUN_TARGET_TOKEN is required (testnet token to buy)}"

# Fallback: if verifier key is missing or placeholder, reuse deployer key for single-verifier E2E.
if [[ -z "${VERIFIER_PRIVATE_KEY:-}" || ! "${VERIFIER_PRIVATE_KEY}" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
  export VERIFIER_PRIVATE_KEY="$DEPLOYER_PRIVATE_KEY"
fi

export CHAIN_ID="${CHAIN_ID:-10143}"
export NADFUN_LENS_ADDRESS="${NADFUN_LENS_ADDRESS:-0xB056d79CA5257589692699a46623F901a3BB76f1}"
export NADFUN_WMON_ADDRESS="${NADFUN_WMON_ADDRESS:-0xFb8bE43D65FBC1290D6178C6DbA6E58c6D18fA60}"
: "${NADFUN_BONDING_CURVE_ROUTER:?NADFUN_BONDING_CURVE_ROUTER is required (set latest Monad testnet NadFun bonding router)}"
: "${NADFUN_DEX_ROUTER:?NADFUN_DEX_ROUTER is required (set latest Monad testnet NadFun dex router)}"
export TRADE_AMOUNT_IN="${TRADE_AMOUNT_IN:-10000000000000000}" # 0.01 MON
export MAX_SLIPPAGE_BPS="${MAX_SLIPPAGE_BPS:-300}"            # 3%
export INTENT_TTL_SECONDS="${INTENT_TTL_SECONDS:-600}"
export INTENT_THRESHOLD_WEIGHT="${INTENT_THRESHOLD_WEIGHT:-1}"
export VERIFIER_WEIGHT="${VERIFIER_WEIGHT:-1}"
export ATTESTATION_NONCE="${ATTESTATION_NONCE:-1}"
if [[ -z "${SNAPSHOT_HASH:-}" ]]; then
  export SNAPSHOT_HASH
  SNAPSHOT_HASH="$(cast keccak "snapshot-$(date +%s)")"
  export SNAPSHOT_HASH
fi

echo "[e2e] deploying intent/core/vault/adapter stack..."
cd "$CONTRACTS_DIR"
forge script script/DeployClawIntentStack.s.sol:DeployClawIntentStack \
  --rpc-url "$RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast

CHAIN_ID_ONCHAIN="$(cast chain-id --rpc-url "$RPC_URL")"
RUN_JSON="$CONTRACTS_DIR/broadcast/DeployClawIntentStack.s.sol/$CHAIN_ID_ONCHAIN/run-latest.json"
if [[ ! -f "$RUN_JSON" ]]; then
  echo "[e2e] deploy run-latest missing: $RUN_JSON" >&2
  exit 1
fi

export SNAPSHOT_BOOK_ADDRESS
SNAPSHOT_BOOK_ADDRESS="$(jq -r '.transactions[] | select(.contractName=="MockSnapshotBook") | .contractAddress' "$RUN_JSON" | tail -n1)"

mapfile -t PROXY_ADDRESSES < <(
  jq -r '.transactions[]
    | select(.transactionType=="CREATE" and .contractName=="ERC1967Proxy")
    | .contractAddress' "$RUN_JSON"
)

# DeployClawIntentStack.s.sol deploy order:
# 1) IntentBook proxy, 2) Vault proxy, 3) Core proxy, 4) Adapter proxy
if [[ "${#PROXY_ADDRESSES[@]}" -lt 4 ]]; then
  echo "[e2e] expected at least 4 ERC1967Proxy deployments, got ${#PROXY_ADDRESSES[@]}" >&2
  exit 1
fi

export INTENT_BOOK_ADDRESS
INTENT_BOOK_ADDRESS="${PROXY_ADDRESSES[0]}"
export VAULT_ADDRESS
VAULT_ADDRESS="${PROXY_ADDRESSES[1]}"
export CORE_ADDRESS
CORE_ADDRESS="${PROXY_ADDRESSES[2]}"
export ADAPTER_ADDRESS
ADAPTER_ADDRESS="${PROXY_ADDRESSES[3]}"

for addr in "$SNAPSHOT_BOOK_ADDRESS" "$INTENT_BOOK_ADDRESS" "$VAULT_ADDRESS" "$CORE_ADDRESS" "$ADAPTER_ADDRESS"; do
  if [[ ! "$addr" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
    echo "[e2e] invalid address parsed: $addr" >&2
    exit 1
  fi
done

OUT_ENV="$CONTRACTS_DIR/.claw.e2e.env"
cat > "$OUT_ENV" <<ENV
SNAPSHOT_HASH=$SNAPSHOT_HASH
SNAPSHOT_BOOK_ADDRESS=$SNAPSHOT_BOOK_ADDRESS
INTENT_BOOK_ADDRESS=$INTENT_BOOK_ADDRESS
VAULT_ADDRESS=$VAULT_ADDRESS
CORE_ADDRESS=$CORE_ADDRESS
ADAPTER_ADDRESS=$ADAPTER_ADDRESS
NADFUN_WMON_ADDRESS=$NADFUN_WMON_ADDRESS
NADFUN_TARGET_TOKEN=$NADFUN_TARGET_TOKEN
TRADE_AMOUNT_IN=$TRADE_AMOUNT_IN
MAX_SLIPPAGE_BPS=$MAX_SLIPPAGE_BPS
ENV

echo "[e2e] wrote $OUT_ENV"
cat "$OUT_ENV"

echo "[e2e] computing SDK-formatted intent payload..."
cd "$ROOT"
eval "$(npm run -w @claw/protocol-sdk intent:compute:nadfun --silent)"

echo "[e2e] proposing+attesting+executing intent onchain..."
cd "$CONTRACTS_DIR"
forge script script/RunIntentBuyE2E.s.sol:RunIntentBuyE2E \
  --rpc-url "$RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast

echo "[e2e] final vault token-out balance:"
cast call "$NADFUN_TARGET_TOKEN" "balanceOf(address)(uint256)" "$VAULT_ADDRESS" --rpc-url "$RPC_URL"

echo "[e2e] complete"
