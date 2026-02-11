#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CONTRACTS_DIR="$ROOT/packages/contracts"
SDK_DIR="$ROOT/packages/sdk"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
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
export NADFUN_WMON_ADDRESS="${NADFUN_WMON_ADDRESS:-0x5a4E0bFDeF88C9032CB4d24338C5EB3d3870BfDd}"
export NADFUN_BONDING_CURVE_ROUTER="${NADFUN_BONDING_CURVE_ROUTER:-0x865054F0F6A288adaAc30261731361EA7E908003}"
export NADFUN_DEX_ROUTER="${NADFUN_DEX_ROUTER:-0x5D4a4f430cA3B1b2dB86B9cFE48a5316800F5fb2}"
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
export INTENT_BOOK_ADDRESS
INTENT_BOOK_ADDRESS="$(jq -r '.transactions[] | select(.contractName=="IntentBook") | .contractAddress' "$RUN_JSON" | tail -n1)"
export VAULT_ADDRESS
VAULT_ADDRESS="$(jq -r '.transactions[] | select(.contractName=="ClawVault4626") | .contractAddress' "$RUN_JSON" | tail -n1)"
export CORE_ADDRESS
CORE_ADDRESS="$(jq -r '.transactions[] | select(.contractName=="ClawCore") | .contractAddress' "$RUN_JSON" | tail -n1)"
export ADAPTER_ADDRESS
ADAPTER_ADDRESS="$(jq -r '.transactions[] | select(.contractName=="NadfunExecutionAdapter") | .contractAddress' "$RUN_JSON" | tail -n1)"

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
