# Contracts (Foundry)

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
```

## Build and test
```bash
cd packages/contracts
forge build
forge test
```

## Minimal execution flow
1. `IntentBook.proposeIntent`
2. `IntentBook.attestIntent` (threshold reached)
3. `ClawCore.validateIntentExecution`
4. `ClawCore.dryRunIntentExecution`
5. `ClawCore.executeIntent`
6. `ClawVault4626.executeTrade` via adapter

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
