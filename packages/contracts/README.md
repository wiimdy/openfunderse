# Contracts (Foundry)

## Role
- Monorepo onchain source of truth.
- Owns fund lifecycle contracts (`ClawFundFactory`, `IntentBook`, `ClawCore`, `ClawVault4626`) and NadFun execution adapter.

MVP contracts:
- `ClawFundFactory`
- `IntentBook`
- `ClawCore`
- `ClawVault4626`
- `NadfunExecutionAdapter`

## Setup
```bash
cd packages/contracts
cp .env.example .env.local
set -a
source .env.local
set +a
forge install --no-git OpenZeppelin/openzeppelin-contracts@v5.5.0
forge install --no-git OpenZeppelin/openzeppelin-contracts-upgradeable@v5.5.0
```

## Build and test
```bash
cd packages/contracts
forge build
forge test
```

## Minimal execution flow
1. `IntentBook.proposeIntent`
2. `IntentBook.attestIntent` (weighted threshold reached)
3. `ClawCore.validateIntentExecution` for preflight checks
4. `ClawCore.dryRunIntentExecution` for quote/reason diagnostics
5. `ClawCore.executeIntent` (executor-only, deadline/replay/maxNotional/allowlist checks)
6. `ClawVault4626.executeTrade` via `NadfunExecutionAdapter`

## Script entrypoints
- Deploy fund factory (admin): `./packages/contracts/scripts/deploy-fund-factory.sh`
- Deploy core stack: `./packages/contracts/scripts/deploy-clawcore-stack.sh`
- Validate intent (eth_call): `./packages/contracts/scripts/validate-intent-call.sh`
- Dry-run intent (quote + reason code): `./packages/contracts/scripts/dry-run-intent-call.sh`
- Full NadFun E2E (optional): `./packages/contracts/scripts/run-nadfun-e2e.sh`

Detailed script docs:
- [`scripts/README.md`](scripts/README.md)

## Detailed docs
- Manual validation runbook: [`../../docs/protocol/intent-manual-validation.md`](../../docs/protocol/intent-manual-validation.md)
- Protocol hashing: [`../../docs/protocol/hashing-eip712-v1.md`](../../docs/protocol/hashing-eip712-v1.md)
- Protocol conformance plan: [`../../docs/protocol/conformance-plan-v1.md`](../../docs/protocol/conformance-plan-v1.md)
- ERC-4626 hardening plan: [`../../docs/security/erc4626-hardening-plan.md`](../../docs/security/erc4626-hardening-plan.md)

## Factory (admin-first fund bootstrap)
`ClawFundFactory` creates a per-fund stack in one transaction:
- `IntentBook` proxy
- `ClawCore` proxy
- `ClawVault4626` proxy

It configures initial verifiers/token allowlist/adapter allowlist and then transfers ownership to the fund owner.

## Recommended test flow
- Unit/integration: `forge test`
- Pre-execution validation: `scripts/validate-intent-call.sh` (`eth_call`)
- Submit `executeIntent` only after preflight passes
- Manual runbook: `docs/protocol/intent-manual-validation.md`

## Executor authorization model
- `ClawCore.executeIntent` is callable only by `executor`.
- Default executor is `owner` at deployment. For operations, set your relayer wallet:

```solidity
core.setExecutor(relayerExecutor);
```
