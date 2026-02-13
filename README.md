# Openfunderse

Openfunderse is an agent-driven fund protocol for Monad: data claims are attested, intents are validated, and only approved intents can execute onchain.

## What matters first
- `packages/contracts`: Foundry contracts (`ClawFundFactory`, `IntentBook`, `ClawCore`, `ClawVault4626`, NadFun adapter)
- `packages/relayer`: API/aggregation layer for fund events and attestations
- `packages/agents`: crawler/verifier/strategy agent runtime
- `packages/sdk`: shared hashing + EIP-712 utilities

## Package roles
| Package | Primary role | Owns | Docs |
| --- | --- | --- | --- |
| `packages/contracts` | Onchain execution and fund governance | UUPS contracts, deployment scripts, Foundry tests | [`packages/contracts/README.md`](packages/contracts/README.md) |
| `packages/relayer` | Offchain API and orchestration | v1 API, attest/intent aggregation, execution jobs, storage integration | [`packages/relayer/README.md`](packages/relayer/README.md) |
| `packages/agents` | Runtime bots for crawling/verifying/strategy | Reddit MVP crawler/verifier flow, bot runtime exports | [`packages/agents/README.md`](packages/agents/README.md) |
| `packages/sdk` | Canonical protocol utilities | Hashing, EIP-712 verification, weighted-threshold helpers | [`packages/sdk/README.md`](packages/sdk/README.md) |
| `packages/openfunderse` | Codex skill-pack installer/distribution | `openfunderse` install CLI, pack manifests/prompts/skills | [`packages/openfunderse/README.md`](packages/openfunderse/README.md) |
| `packages/indexer` | Deferred read-model/indexing layer | Placeholder scaffold for future event indexing | [`packages/indexer/README.md`](packages/indexer/README.md) |

## Quick start
```bash
nvm use
npm install
```

```bash
cd packages/contracts
cp .env.example .env.local
forge build
forge test
```

## Main workflows
- Admin fund bootstrap (factory): `./packages/contracts/scripts/deploy-fund-factory.sh`
- Contract deployment: `./packages/contracts/scripts/deploy-clawcore-stack.sh`
- Intent preflight check: `./packages/contracts/scripts/validate-intent-call.sh`
- Intent dry-run check: `./packages/contracts/scripts/dry-run-intent-call.sh`
- End-to-end NadFun flow (optional): `./packages/contracts/scripts/run-nadfun-e2e.sh`

Detailed script usage and required envs:
- [`packages/contracts/scripts/README.md`](packages/contracts/scripts/README.md)

## Documentation index
Use the docs index as the single navigation entry:
- [`docs/README.md`](docs/README.md)

High-signal docs:
- Manual intent validation: [`docs/protocol/intent-manual-validation.md`](docs/protocol/intent-manual-validation.md)
- Protocol hashing/EIP-712: [`docs/protocol/hashing-eip712-v1.md`](docs/protocol/hashing-eip712-v1.md)
- Contracts package guide: [`packages/contracts/README.md`](packages/contracts/README.md)
