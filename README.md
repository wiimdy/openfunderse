# Openfunderse

Openfunderse is an agent-driven fund protocol for Monad: data claims are attested, intents are validated, and only approved intents can execute onchain.

## Consensus Rebalancing Model (Risk-Projected Aggregation)
Let whitelist assets be $\mathcal A=\{1,\dots,n\}$ and participants be $\mathcal P$.

Flow (v0 safe patch):
1. Participants submit target weights $c_{i,t}\in\Delta^n$.
2. Stake-weighted aggregate is projected into a feasible risk set.
3. Strategy executes toward projected target under venue constraints.
4. Participant prediction score $g_{i,t}$ is settled on oracle return.
5. Stake weights update multiplicatively; positive NAV alpha mints extra shares.

Fund state:
```math
V_t=p_t^\top h_t,\qquad
s_t=\frac{p_t\odot h_t}{V_t}\in\Delta^n,\qquad
\sum_{i\in\mathcal P} w_{i,t}=1,\;w_{i,t}\ge0.
```

Aggregation and projection:
```math
\bar s_t=\sum_{i\in\mathcal P}w_{i,t}c_{i,t},
\qquad
s_t^\star=\Pi_{\mathcal R_t}(\bar s_t)
=\arg\min_{x\in\mathcal R_t}\|x-\bar s_t\|_2^2.
```
```math
\mathcal R_t=
\left\{
x\in\Delta^n:
\|x-s_t\|_1\le\tau_t,\;
\forall j\in\mathcal A,\;x_j\le u_j
\right\}.
```

Execution:
```math
z_t^\star=\arg\min_{z}\|s_{t+1}(z)-s_t^\star\|_2^2,
```
with per-leg feasibility (example):
```math
y_\ell\ge x_\ell\pi_\ell,\qquad
x_\ell\in[0,X_\ell],\;y_\ell\in[0,Y_\ell].
```

Oracle return (manipulation-resistant source):
```math
p_t:=P(t;W),\qquad
r_t^H=\frac{p_{t+H}-p_t}{p_t},
```
where $P$ is TWAP/medianized oracle over window $W$.

Participant prediction score:
```math
g_{i,t}=(c_{i,t}-s_t^\star)^\top r_t^H.
```

Stake update (prediction-market style):
```math
\widetilde w_{i,t+1}
=w_{i,t}\exp\!\left(\eta\cdot\mathrm{clip}(g_{i,t},-b,b)\right),
\qquad
w_{i,t+1}
=\frac{\widetilde w_{i,t+1}}{\sum_{k\in\mathcal P}\widetilde w_{k,t+1}}.
```

NAV alpha and mint budget:
```math
\alpha_t^{\mathrm{NAV}}
=\frac{V_{t+H}-V_t}{V_t}-\mathrm{bench}_t,\qquad
M_t=\mu[\alpha_t^{\mathrm{NAV}}]_+N_t.
```

Mint allocation (Sybil-resistant via stake weighting):
```math
\phi(g)=\exp\!\left(\eta\cdot\mathrm{clip}(g,-b,b)\right),
\qquad
\Delta N_{i,t}
=M_t\frac{w_{i,t}\phi(g_{i,t})}{\sum_{k\in\mathcal P}w_{k,t}\phi(g_{k,t})+\varepsilon}.
```

Share-weight identity:
```math
w_{i,t}=\frac{N_{i,t}}{N_t},\qquad N_t=\sum_{i\in\mathcal P}N_{i,t}.
```

Parameters:
```math
\tau_t,\{u_j\}_{j\in\mathcal A},\eta,b,\mu,\varepsilon,W,\mathrm{bench}_t.
```

*Inspired by stake-weighted subjective-consensus literature (incl. Yuma-style clipping), adapted to portfolio allocation with explicit risk projection and execution constraints.
*Operational note: projection $\Pi_{\mathcal R_t}$, score computation, and oracle assembly are offchain (relayer/strategy), while settlement constraints remain onchain-enforced.

## What matters first
- `packages/contracts`: Foundry contracts (`ClawFundFactory`, `IntentBook`, `ClawCore`, `ClawVault4626`, NadFun adapter)
- `packages/relayer`: API/aggregation layer for fund events and attestations
- `packages/agents`: participant/strategy agent runtime
- `packages/sdk`: shared hashing + EIP-712 utilities

## Package roles
| Package | Primary role | Owns | Docs |
| --- | --- | --- | --- |
| `packages/contracts` | Onchain execution and fund governance | UUPS contracts, deployment scripts, Foundry tests | [`packages/contracts/README.md`](packages/contracts/README.md) |
| `packages/relayer` | Offchain API and orchestration | v1 API, attest/intent aggregation, execution jobs, storage integration | [`packages/relayer/README.md`](packages/relayer/README.md) |
| `packages/agents` | Runtime bots for participant/strategy | Reddit MVP participant flow, bot runtime exports | [`packages/agents/README.md`](packages/agents/README.md) |
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
