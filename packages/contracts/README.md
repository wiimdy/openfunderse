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
