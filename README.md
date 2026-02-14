# Openfunderse

Openfunderse is an agent-driven fund protocol for Monad: data claims are attested, intents are validated, and only approved intents can execute onchain.

## Consensus Rebalancing Model (Risk-Projected Aggregation)
Let whitelist assets be $\mathcal{A}=\{1,\dots,n\}$.

Flow (v0 minimal):
1. Participants submit target weights $c_{i,t}\in\Delta^n$.
2. Claims are stake-aggregated and projected into a simple risk-feasible set.
3. Strategy solves execution to move $s_t \to s_t^\star$ under market constraints.
4. Calibration + realized marginal PnL define participant score.
5. Positive-alpha epochs mint shares to high-score participants.

Fund state:
$$
V_t=p_t^\top h_t,\quad
s_t=\frac{p_t\odot h_t}{V_t}\in\Delta^n,\quad
\sum_i w_{i,t}=1,\;w_{i,t}\ge0.
$$

Raw aggregate view:
$$
\bar s_t=\sum_i w_{i,t}c_{i,t}.
$$

Risk-projected target (core change):
$$
s_t^\star=\Pi_{\mathcal R_t}(\bar s_t)
=\arg\min_{x\in\mathcal R_t}\|x-\bar s_t\|_2^2,
$$
with $\mathcal R_t\subset\Delta^n$ non-empty, closed, convex and
$$
\|x-s_t\|_1\le \tau_t,\quad
x_j\le u_j.
$$

Execution intent:
$$
z_t^\star=\arg\min_{z}
\|s_{t+1}(z)-s_t^\star\|_2^2
$$
subject to per-leg acceptance constraints:
$$
x_\ell \ge y_\ell/\pi_\ell,\; y_\ell\in[0,Y_\ell],\qquad
y_\ell \le x_\ell\pi_\ell,\; x_\ell\in[0,X_\ell].
$$

Realized alpha (horizon $H$):
$$
r_t^H=\frac{p_{t+H}-p_t}{p_t},\qquad
\alpha_t=(s_{t+1}-s_t)^\top r_t^H-\mathrm{cost}_t.
$$

Marginal contribution:
$$
m_{i,t}=V_{t+H}(s_t^\star)-V_{t+H}(s_t^{\star(-i)}),\qquad
\widehat C^{\mathrm{pnl}}_{i,t}=\frac{[m_{i,t}]_+}{\sum_k[m_{k,t}]_+ + \varepsilon}.
$$

Calibration score (ex-ante consistency):
$$
C^{\mathrm{cal}}_{i,t}=1-\frac{\|c_{i,t}-s_t^\star\|_1}{2}\in[0,1].
$$

Reward score:
$$
E_{i,t}=
\xi C^{\mathrm{cal}}_{i,t}
+(1-\xi)\widehat C^{\mathrm{pnl}}_{i,t}.
$$

Mint budget and allocation:
$$
M_t=\mu[\alpha_t]_+N_t,\qquad
\Delta N_{i,t}=M_t\frac{E_{i,t}}{\sum_k E_{k,t}+\varepsilon}.
$$

Stake update (canonical):
$$
w_{i,t+1}
=\frac{w_{i,t}N_t+\Delta N_{i,t}}{N_t+M_t},
$$

Parameters:
$$
\tau_t,\{u_j\}_{j\in\mathcal A},\xi,\mu,\varepsilon.
$$

*Inspired by stake-weighted subjective-consensus literature (incl. Yuma-style clipping), adapted to portfolio allocation with explicit risk projection and execution constraints.
*Operational note: projection $\Pi_{\mathcal R_t}$, contribution $m_{i,t}$, and score computation are offchain (relayer/strategy), while settlement constraints remain onchain-enforced.

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
