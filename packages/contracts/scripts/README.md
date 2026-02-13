# Contracts Scripts

This folder contains runtime shell entrypoints. Foundry Solidity scripts are in `packages/contracts/script`.

## Scripts

### `intent-call.sh`
Purpose:
- Shared entrypoint for no-state preflight calls.
- Modes:
  - `validate`: `validateIntentExecution(...)`
  - `dry-run`: `dryRunIntentExecution(...)`

Usage:
```bash
./packages/contracts/scripts/intent-call.sh validate
./packages/contracts/scripts/intent-call.sh dry-run
```

### `deploy-fund-factory.sh`
Purpose:
- Deploy `ClawFundFactory` for admin-driven one-transaction fund bootstrap.

Required env:
- `RPC_URL`
- `DEPLOYER_PRIVATE_KEY`
- Optional: `FACTORY_OWNER` (default: deployer EOA)

### `deploy-clawcore-stack.sh`
Purpose:
- Deploy `ClawVault4626`, `ClawCore`, and `NadfunExecutionAdapter` for an existing `IntentBook`.

Required env:
- `RPC_URL`
- `DEPLOYER_PRIVATE_KEY`
- `INTENT_BOOK_ADDRESS`
- `NADFUN_WMON_ADDRESS`
- `NADFUN_BONDING_CURVE_ROUTER`
- `NADFUN_DEX_ROUTER`

Output:
- `packages/contracts/.clawcore.deploy.env`

### `validate-intent-call.sh`
Purpose:
- Compatibility wrapper for `intent-call.sh validate`.

Required env:
- `RPC_URL`
- `CLAW_CORE_ADDRESS`
- `INTENT_HASH`
- `TOKEN_IN`
- `TOKEN_OUT`
- `AMOUNT_IN`
- `QUOTE_AMOUNT_OUT`
- `MIN_AMOUNT_OUT`
- `ADAPTER`
- `ADAPTER_DATA`

### `dry-run-intent-call.sh`
Purpose:
- Compatibility wrapper for `intent-call.sh dry-run`.

Required env:
- Same as `validate-intent-call.sh`

### `run-nadfun-e2e.sh` (optional)
Purpose:
- Full E2E path: deploy intent stack, compute SDK payload, attest, execute.

When to use:
- Integration smoke test on Monad testnet.

## Governance Hardening (Foundry Scripts)

### `script/DeployGovernanceTimelock.s.sol`
Purpose:
- Deploy OpenZeppelin `TimelockController` for delayed governance execution.

Required env:
- `RPC_URL`
- `DEPLOYER_PRIVATE_KEY`

Optional env:
- `TIMELOCK_MIN_DELAY_SECONDS` (default: `172800`)
- `TIMELOCK_PROPOSER` (default: deployer)
- `TIMELOCK_EXECUTOR` (default: deployer)
- `TIMELOCK_ADMIN` (default: deployer)

Example:
```bash
forge script script/DeployGovernanceTimelock.s.sol:DeployGovernanceTimelock \
  --rpc-url "$RPC_URL" --broadcast
```

### `script/HardenFundGovernance.s.sol`
Purpose:
- Freeze mutable config and/or upgrades, then transfer ownership to timelock.

Required env:
- `RPC_URL`
- `DEPLOYER_PRIVATE_KEY`
- `GOVERNANCE_TIMELOCK`
- At least one of:
  - `CORE_ADDRESS`
  - `VAULT_ADDRESS`
  - `INTENT_BOOK_ADDRESS`
  - `ADAPTER_ADDRESS`

Optional env:
- `FREEZE_CONFIG` (default: `true`)
- `FREEZE_UPGRADES` (default: `false`)

Example:
```bash
forge script script/HardenFundGovernance.s.sol:HardenFundGovernance \
  --rpc-url "$RPC_URL" --broadcast
```

## Notes
- For full manual flow with step-by-step examples, use:
  - [`../../../docs/protocol/intent-manual-validation.md`](../../../docs/protocol/intent-manual-validation.md)
