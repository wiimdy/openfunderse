#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PASS=0
FAIL=0

pass() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
fail() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }

echo "========================================"
echo " OpenClaw E2E Local Happy Path"
echo "========================================"

if [[ ! -f .env ]]; then
  echo "[setup] .env not found — copying from .env.example"
  cp .env.example .env
fi

echo ""
echo "[1/6] Contracts — forge build + test"
if command -v forge >/dev/null 2>&1; then
  if (cd packages/contracts && forge build --silent 2>/dev/null); then
    pass "forge build"
  else
    fail "forge build"
  fi

  if (cd packages/contracts && forge test --match-contract IntentBookTest -vv 2>&1 | grep -q "0 failed"); then
    pass "IntentBook tests"
  else
    fail "IntentBook tests"
  fi
else
  echo "  ⚠️  forge not found — skipping contract tests"
fi

echo ""
echo "[2/6] SDK — build + test"
if npm run build -w @claw/protocol-sdk --silent 2>/dev/null; then
  pass "SDK build"
else
  fail "SDK build"
fi

if npm test -w @claw/protocol-sdk 2>&1 | grep -q "pass"; then
  pass "SDK tests"
else
  fail "SDK tests"
fi

echo ""
echo "[3/6] Agents — build"
if npm run build -w @claw/agents --silent 2>/dev/null; then
  pass "agents build"
else
  fail "agents build"
fi

echo ""
echo "[4/6] Agents — skill exports"
EXPORT_CHECK=$(node --input-type=module -e "
import { mineClaim, verifyClaim, proposeIntent } from './packages/agents/dist/index.js';
const ok = typeof mineClaim === 'function' && typeof verifyClaim === 'function' && typeof proposeIntent === 'function';
console.log(ok ? 'EXPORTS_OK' : 'EXPORTS_FAIL');
" 2>&1)

if [[ "$EXPORT_CHECK" == *"EXPORTS_OK"* ]]; then
  pass "mineClaim, verifyClaim, proposeIntent exported"
else
  fail "skill exports check"
fi

echo ""
echo "[5/6] Integration — in-process skill execution"
INTEGRATION_CHECK=$(node --input-type=module -e "
import { mineClaim, verifyClaim, proposeIntent } from './packages/agents/dist/index.js';

let passed = 0;
let failed = 0;

const mined = await mineClaim({
  taskType: 'propose_allocation',
  fundId: 'fund-001',
  roomId: 'room-001',
  epochId: 1,
  allocation: {
    participant: '0x00000000000000000000000000000000000000b2',
    targetWeights: ['7000', '3000'],
    horizonSec: 3600,
    nonce: 1
  }
});

if (mined.status === 'OK' && mined.observation) {
  passed++;
  console.log('MINE_ALLOCATION_PASS');
} else {
  failed++;
  console.log('MINE_ALLOCATION_FAIL');
}

const claimResult = await verifyClaim({
  taskType: 'validate_allocation_or_intent',
  fundId: 'fund-001',
  roomId: 'room-001',
  epochId: 1,
  subjectType: 'CLAIM',
  subjectHash: mined.status === 'OK' && mined.observation ? mined.observation.claimHash : '0x0',
  subjectPayload:
    mined.status === 'OK' && mined.observation
      ? mined.observation.canonicalClaim
      : {},
  validationPolicy: { reproducible: true, maxDataAgeSeconds: 3600 },
});

if (claimResult.verdict === 'PASS') {
  passed++;
  console.log('VERIFY_CLAIM_PASS');
} else {
  failed++;
  console.log('VERIFY_CLAIM_FAIL:' + claimResult.verdict + ':' + claimResult.reason);
}

const intentMissingSnapshot = await verifyClaim({
  taskType: 'validate_allocation_or_intent',
  fundId: 'fund-001',
  roomId: 'room-001',
  epochId: 1,
  subjectType: 'INTENT',
  subjectHash: '0xdef',
  subjectPayload: {},
  validationPolicy: { reproducible: true, maxDataAgeSeconds: 3600 },
});

if (intentMissingSnapshot.verdict === 'NEED_MORE_EVIDENCE') {
  passed++;
  console.log('INTENT_MISSING_SNAPSHOT_PASS');
} else {
  failed++;
  console.log('INTENT_MISSING_SNAPSHOT_FAIL:' + intentMissingSnapshot.verdict);
}

const holdResult = await proposeIntent({
  taskType: 'propose_intent',
  fundId: 'fund-001',
  roomId: 'room-001',
  epochId: 1,
  snapshot: { snapshotHash: '0xaaa', finalized: false, claimCount: 5 },
  marketState: { network: 10143, nadfunCurveState: {}, liquidity: {}, volatility: {} },
  riskPolicy: { maxNotional: '1000', maxSlippageBps: 80, allowlistTokens: ['0x1', '0x2'], allowlistVenues: ['NadFun'] },
});

if (holdResult.decision === 'HOLD' && holdResult.reason === 'snapshot not finalized') {
  passed++;
  console.log('HOLD_UNFINALIZED_PASS');
} else {
  failed++;
  console.log('HOLD_UNFINALIZED_FAIL:' + JSON.stringify(holdResult));
}

const proposeResult = await proposeIntent({
  taskType: 'propose_intent',
  fundId: 'fund-001',
  roomId: 'room-001',
  epochId: 1,
  snapshot: { snapshotHash: '0xbbb', finalized: true, claimCount: 5 },
  marketState: { network: 10143, nadfunCurveState: {}, liquidity: {}, volatility: {} },
  riskPolicy: { maxNotional: '1000', maxSlippageBps: 80, allowlistTokens: ['0x1', '0x2'], allowlistVenues: ['NadFun'] },
});

if (proposeResult.decision === 'PROPOSE' && proposeResult.intent.snapshotHash === '0xbbb') {
  passed++;
  console.log('PROPOSE_OK_PASS');
} else {
  failed++;
  console.log('PROPOSE_OK_FAIL:' + JSON.stringify(proposeResult));
}

console.log('INTEGRATION_RESULT:' + passed + ':' + failed);
" 2>&1)

echo "$INTEGRATION_CHECK" | while IFS= read -r line; do
  case "$line" in
    *_PASS) ;;
    INTEGRATION_RESULT:*) ;;
    *_FAIL*) ;;
    *) ;;
  esac
done

INT_PASSED=$(echo "$INTEGRATION_CHECK" | grep "INTEGRATION_RESULT" | cut -d: -f2)
INT_FAILED=$(echo "$INTEGRATION_CHECK" | grep "INTEGRATION_RESULT" | cut -d: -f3)

if [[ "${INT_FAILED:-1}" == "0" ]]; then
  pass "all ${INT_PASSED} integration scenarios passed"
else
  fail "${INT_FAILED} integration scenario(s) failed (${INT_PASSED} passed)"
  echo "$INTEGRATION_CHECK" | grep "FAIL" | while IFS= read -r line; do echo "    → $line"; done
fi

echo ""
echo "[6/6] Monorepo structure"
for pkg in package.json packages/sdk/package.json packages/relayer/package.json packages/agents/package.json packages/contracts/foundry.toml; do
  if [[ -f "$pkg" ]]; then
    pass "$pkg exists"
  else
    fail "$pkg missing"
  fi
done

echo ""
echo "========================================"
echo " Results: ${PASS} passed, ${FAIL} failed"
echo "========================================"

if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi

echo ""
echo "🎉 E2E happy path complete"
