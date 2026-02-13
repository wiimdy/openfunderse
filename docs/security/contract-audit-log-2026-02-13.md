# Contract Audit Log - 2026-02-13

Date: 2026-02-13
Repository: `wiimdy/openfunderse`
Issue: https://github.com/wiimdy/openfunderse/issues/43
Branch: `codex/nadfun-dryrun-vault-upgrade`

## 1) Audit objective
- Validate recent contract changes for:
  - execution preflight (`dryRunIntentExecution`)
  - vault accounting correctness
  - security posture (signature and execution paths)

## 2) Process record
- Step 1. Manual code review on:
  - `packages/contracts/src/ClawVault4626.sol`
  - `packages/contracts/src/ClawCore.sol`
  - `packages/contracts/src/adapters/NadfunExecutionAdapter.sol`
  - `packages/contracts/src/ClaimBook.sol`
  - `packages/contracts/src/IntentBook.sol`
- Step 2. Finding classification (logic/security):
  - F-01: Share accounting risk when non-asset inventory is open
  - F-02: Potential over-fee on selling untracked inventory
  - F-03: Missing low-s enforcement in ECDSA recovery
- Step 3. Patch implementation
- Step 4. Regression and security tests (`forge test`)
- Step 5. Documentation and plan archival

## 3) Findings and remediation status
- F-01 (High): open position accounting mismatch with share ops
  - Status: FIXED
  - Mitigation: block share ops while open positions exist (`hasOpenPositions` gate)
- F-02 (Medium): fee overcharge potential on untracked sell quantity
  - Status: FIXED
  - Mitigation: compute realized PnL from matched tracked quantity proceeds only
- F-03 (Low): ECDSA malleability surface (high-s)
  - Status: FIXED
  - Mitigation: low-s + zero r/s checks in signer recovery

## 4) Test evidence
Command:
```bash
cd packages/contracts
NO_PROXY='*' HTTPS_PROXY='' HTTP_PROXY='' ALL_PROXY='' forge test
```

Result:
- 37 passed
- 0 failed
- 0 skipped

Added/updated tests include:
- `testShareOpsBlockedWhileOpenPositionsExist`
- `testUntrackedSellPortionDoesNotMintPerformanceFee`
- `testAttestClaimRevertsOnHighSSignature`
- `testAttestIntentRevertsOnHighSSignature`

## 5) Remaining hardening backlog
- Implement full ERC-4626 limit views (`maxDeposit/maxWithdraw/...`)
- Add NAV valuation adapter for non-asset holdings and integrate into `totalAssets`
- Add invariant/fuzz test suite for share fairness and fee monotonicity

Detailed plan: `docs/security/erc4626-hardening-plan.md`
