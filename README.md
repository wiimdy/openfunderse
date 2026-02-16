# Openfunderse

Openfunderse is an agent-driven fund protocol for Monad: data claims are attested, intents are validated, and only approved intents can execute onchain.

## Consensus Rebalancing Model (Risk-Projected Aggregation)
Let whitelist assets be $\mathcal A=\{1,\dots,n\}$ and participants be $\mathcal P$.

Flow (v0 safe patch):
1. Participants submit target weights $c_{i,t}\in\Delta^n$.
2. Stake-weighted aggregate is projected into a feasible risk set.
3. Strategy executes toward projected target under venue constraints and execution cost.
4. Participant prediction score $g_{i,t}$ is settled on scoring oracle return.
5. Positive NAV alpha mints extra shares; next weights are induced only by share balances.

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
z_t^\star=\arg\min_{z}
\left(\|s_{t+1}(z)-s_t^\star\|_2^2+\lambda\cdot \mathrm{Cost}(z)\right),
```
with per-leg feasibility (example):
```math
y_\ell\ge x_\ell\pi_\ell,\qquad
x_\ell\in[0,X_\ell],\;y_\ell\in[0,Y_\ell].
```

Oracle model (execution vs scoring):
```math
p_t^{\mathrm{exec}}:=P_{\mathrm{twap}}(t;W_{\mathrm{exec}}),\qquad
p_t^{\mathrm{score}}:=P_{\mathrm{score}}(t),\qquad
r_t^H=\frac{p_{t+H}^{\mathrm{score}}-p_t^{\mathrm{score}}}{p_t^{\mathrm{score}}},
```
where $P_{\mathrm{twap}}$ is execution-safe oracle and $P_{\mathrm{score}}$ is performance-scoring oracle.

Participant prediction score:
```math
g_{i,t}=c_{i,t}^\top r_t^H-\mathrm{bench}_t.
```

NAV alpha and mint budget:
```math
\alpha_t^{\mathrm{NAV}}
=\frac{V_{t+H}-V_t}{V_t}-\mathrm{bench}_t,\qquad
M_t=\mu[\alpha_t^{\mathrm{NAV}}]_+N_t.
```

Mint allocation (Sybil-resistant via stake weighting):
```math
\phi(g)=[g]_+,
\qquad
\Delta N_{i,t}
=M_t\frac{w_{i,t}\phi(g_{i,t})}{\sum_{k\in\mathcal P}w_{k,t}\phi(g_{k,t})+\varepsilon}.
```

Share-weight identity:
```math
N_{i,t+1}=N_{i,t}+\Delta N_{i,t},\qquad
N_{t+1}=\sum_{k\in\mathcal P}N_{k,t+1},\qquad
w_{i,t+1}=\frac{N_{i,t+1}}{N_{t+1}}.
```

Parameters:
```math
\tau_t,\{u_j\}_{j\in\mathcal A},\lambda,\mu,\varepsilon,W_{\mathrm{exec}},\mathrm{bench}_t.
```

*Inspired by stake-weighted subjective-consensus literature (incl. Yuma-style clipping), adapted to portfolio allocation with explicit risk projection and execution constraints.
*Operational note: projection $\Pi_{\mathcal R_t}$, score computation, and oracle assembly are offchain (relayer/strategy), while settlement constraints remain onchain-enforced.

## MVP Scope
- Included: participant co-investment claims (`targetWeights`) -> epoch aggregate -> strategy intent propose -> intent attestation/bundle -> ready-for-onchain execution payload.
- Included: index mapping rule `targetWeights[i] <-> riskPolicy.allowlistTokens[i]`; strategy uses aggregate view to choose rebalance direction.
- Included: shared intent execution visibility through relayer status/read APIs.
- TODO (formula-only): reward score settlement, mint budget allocation, and onchain vault share minting from model equations.
- Design note: current contracts/API are intentionally unchanged for reward mint logic in MVP demo.

## What matters first
- `packages/contracts`: Foundry contracts (`ClawFundFactory`, `IntentBook`, `ClawCore`, `ClawVault4626`, NadFun adapter)
- `packages/relayer`: API/aggregation layer for fund events and attestations
- `packages/agents`: participant/strategy agent runtime
- `packages/sdk`: shared hashing + EIP-712 utilities

## Mainnet Contracts (Verified)
- `ClawFundFactory`: `0xf16a12fCeC5FD8eb67eEd57f9659AE730734AA74`
- `MockSnapshotBook`: `0x06676F1eE9480085c01BEdb348C60167EBeE0Cc9`
- `IntentBook` (Implementation): `0x417dDEdbECb746e4474B587dF056a1EB42957e80`
- `IntentBook` (Proxy): `0x23403970eD4891b8f85a414B9B00C239D364D16A`
- `ClawVault4626` (Implementation): `0x2bcB5a88942D474797baB5628c4c04A07E9c1597`
- `ClawVault4626` (Proxy): `0xd1Cd80B55cD1c77116f2b817356f157C116dDAca`
- `ClawCore` (Implementation): `0x251377f58D2F8e1A296c783Dab54A16f70795417`
- `ClawCore` (Proxy): `0x6e81c81912f7714F2BbeD0a369D00Bd218439988`
- `NadfunExecutionAdapter` (Implementation): `0xc4B1F14B85D4DF9C1cf2d5BCc55a114A2860d553`
- `NadfunExecutionAdapter` (Proxy): `0x418F5A1d728b3e23B6B01A04a4FEEa7894f9b2B2`

## Package roles
| Package | Primary role | Owns | Docs |
| --- | --- | --- | --- |
| `packages/contracts` | Onchain execution and fund governance | UUPS contracts, deployment scripts, Foundry tests | [`packages/contracts/README.md`](packages/contracts/README.md) |
| `packages/relayer` | Offchain API and orchestration | v1 API, attest/intent aggregation, execution jobs, storage integration | [`packages/relayer/README.md`](packages/relayer/README.md) |
| `packages/agents` | Runtime bots for participant/strategy | Reddit MVP participant flow, bot runtime exports | [`packages/agents/README.md`](packages/agents/README.md) |
| `packages/sdk` | Canonical protocol utilities | Hashing, EIP-712 verification, weighted-threshold helpers | [`packages/sdk/README.md`](packages/sdk/README.md) |
| `packages/openfunderse` | Codex skill-pack installer/distribution | `openfunderse` install CLI, pack manifests/prompts/skills | [`packages/openfunderse/README.md`](packages/openfunderse/README.md) |

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
