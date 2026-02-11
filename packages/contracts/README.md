# contracts

Foundry-based contracts workspace for OpenClaw.

## Commands

```bash
cd packages/contracts
forge build
forge test
```

Deploy example (adjust env first):

```bash
forge create src/ClawCore.sol:ClawCore \
  --rpc-url "$RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY"
```

## IntentBook local deploy + method exercise

Prerequisite: set these in repository root `.env`

```bash
RPC_URL=http://127.0.0.1:8545
CHAIN_ID=10143
DEPLOYER_PRIVATE_KEY=0x...
```

Deploy `IntentBook` + `MockSnapshotBook`:

```bash
./packages/contracts/scripts/deploy-intentbook-local.sh
```

Exercise IntentBook methods (onchain tx):

```bash
./packages/contracts/scripts/test-intentbook-methods-local.sh
```

The deploy script writes addresses to:

- `packages/contracts/.intentbook.local.env`
