# ERC-4626 Hardening Plan (Monad / Openfunderse)

Date: 2026-02-13
Scope: `ClawVault4626`, share accounting, fee accounting, signature validation path

## 1) Best-practice survey (primary sources)

### BP-01. `totalAssets` must represent all assets managed by vault
- Source: EIP-4626 (`totalAssets`) and OpenZeppelin ERC-4626 docs
- Practical implication:
  - Share mint/burn math (`convertToShares`, `convertToAssets`) is only safe when NAV basis is correct.
  - If non-asset positions are held but not priced into `totalAssets`, deposit/withdraw fairness can break.

### BP-02. Preview/convert semantics and rounding discipline must be explicit
- Source: EIP-4626 (`previewDeposit`, `previewWithdraw`, rounding constraints)
- Practical implication:
  - Down/up rounding must be deterministic.
  - State where pricing is incomplete should be clearly blocked or explicitly handled.

### BP-03. Deposit/withdraw gating should use explicit limits (`maxDeposit`/`maxWithdraw` family)
- Source: EIP-4626 (`maxDeposit`, `maxMint`, `maxWithdraw`, `maxRedeem`)
- Practical implication:
  - Disallowed states are ideally reflected in max* views, not only runtime revert.

### BP-04. Initial deposit / inflation attack protections
- Source: OpenZeppelin ERC-4626 docs (inflation attack & defenses)
- Practical implication:
  - Consider virtual shares/assets or minimum seed liquidity policy.

### BP-05. Fee model must avoid over-charging on untracked inventory
- Source: OpenZeppelin ERC-4626 docs (custom fee patterns) + accounting best practice
- Practical implication:
  - Performance fee should be applied only to attributable realized PnL.

### BP-06. Signature validation should enforce canonical ECDSA (low-s)
- Source: EIP-2 + OpenZeppelin ECDSA docs
- Practical implication:
  - Reject high-s signatures to prevent malleability variants.

## 2) Applied patch plan (executed)

### Phase A (done): Safety hardening without changing protocol surface drastically
- [x] Block share operations when unpriced open positions exist
  - `deposit/depositNative/withdraw/withdrawNative/redeem` now revert with `ShareOpsBlockedWithOpenPositions`
  - Added `openPositionCount`, `hasOpenPositions()`
- [x] Realized PnL / performance fee attribution fix
  - Sell path now computes PnL using matched tracked quantity proceeds only
  - Prevents fee overcharge from untracked inventory
- [x] Canonical signature enforcement
  - Added low-s checks in `ClaimBook` and `IntentBook`

### Phase B (next): Compliance/UX hardening
- [ ] Add explicit ERC-4626 limit views (`maxDeposit/maxWithdraw/...`) aligned with open-position gating
- [ ] Add `pause`-aware limits and front-end safe precheck interface
- [ ] Add tests for limits + preview behavior consistency

### Phase C (next): Full NAV-aware accounting
- [ ] Introduce valuation adapter/oracle for non-asset positions
- [ ] Include priced inventory in NAV basis for `totalAssets`
- [ ] Remove strict share-op lock after NAV accounting is trustworthy

### Phase D (next): Operational controls
- [ ] Add seeding policy / virtual share-asset offset to mitigate first-deposit edge risk
- [ ] Add invariant tests/fuzz for share fairness and fee monotonicity

## 3) Sources
- EIP-4626: https://eips.ethereum.org/EIPS/eip-4626
- OpenZeppelin Contracts ERC-4626 docs (5.x): https://docs.openzeppelin.com/contracts/5.x/erc4626
- OpenZeppelin Contracts Cairo ERC-4626 docs (`total_assets` wording): https://docs.openzeppelin.com/contracts-cairo/2.x/erc4626
- EIP-2 (ECDSA malleability / low-s): https://eips.ethereum.org/EIPS/eip-2
- OpenZeppelin ECDSA docs: https://docs.openzeppelin.com/contracts/5.x/api/utils/cryptography
