# Intent Manual Validation Runbook

목표: 개발자가 직접 콘솔에서 `intent 생성 -> propose -> attest -> 사전검증`을 반복 가능하게 한다.

## 1. Prerequisites

- `IntentBook`, `ClawCore`, `Adapter` 배포 완료
- `snapshotHash` finalized 상태
- strategy/verifier private key 준비
- Node.js + `cast` 설치

## 2. Required Env

```bash
cd <repo-root>
source .env
export RPC_URL=https://testnet-rpc.monad.xyz
export CHAIN_ID=10143
export STRATEGY_PRIVATE_KEY=0x...
export VERIFIER_PRIVATE_KEY=0x...
export INTENT_BOOK_ADDRESS=0x...
export CLAW_CORE_ADDRESS=0x...
export CLAW_VAULT_ADDRESS=0x...
export SNAPSHOT_HASH=0x...
export ADAPTER=0x...
export TOKEN_IN=0x...
export TOKEN_OUT=0x...
export AMOUNT_IN=1000000000000000
export QUOTE_AMOUNT_OUT=100
export MIN_AMOUNT_OUT=1
export MAX_SLIPPAGE_BPS=200
```

## 3. Build SDK

```bash
cd <repo-root>/packages/sdk
npm run build
```

## 4. Generate Intent Values (hash/deadline/adapterData/allowlistHash)

```bash
node --input-type=module <<'EOF'
import { encodeNadfunExecutionDataV1, intentExecutionCallHash, intentHash } from "./dist/index.js";

const now = Math.floor(Date.now()/1000);
const deadline = BigInt(now + 300);

const adapterData = encodeNadfunExecutionDataV1({
  version: 1,
  action: "BUY",
  venue: "NADFUN_BONDING_CURVE",
  router: process.env.NADFUN_BONDING_CURVE_ROUTER || "0x865054F0F6A288adaAc30261731361EA7E908003",
  recipient: process.env.CLAW_VAULT_ADDRESS,
  token: process.env.TOKEN_OUT,
  deadline,
  amountOutMin: BigInt(process.env.MIN_AMOUNT_OUT),
  extra: "0x"
});

const ih = intentHash({
  intentVersion: "v1",
  vault: process.env.CLAW_CORE_ADDRESS,
  action: "BUY",
  tokenIn: process.env.TOKEN_IN,
  tokenOut: process.env.TOKEN_OUT,
  amountIn: BigInt(process.env.AMOUNT_IN),
  minAmountOut: BigInt(process.env.MIN_AMOUNT_OUT),
  deadline,
  maxSlippageBps: BigInt(process.env.MAX_SLIPPAGE_BPS),
  snapshotHash: process.env.SNAPSHOT_HASH
});

const allowlistHash = intentExecutionCallHash(
  process.env.TOKEN_IN,
  process.env.TOKEN_OUT,
  BigInt(process.env.QUOTE_AMOUNT_OUT),
  BigInt(process.env.MIN_AMOUNT_OUT),
  process.env.ADAPTER,
  adapterData
);

console.log(`export INTENT_HASH=${ih}`);
console.log(`export DEADLINE=${deadline.toString()}`);
console.log(`export ADAPTER_DATA=${adapterData}`);
console.log(`export ALLOWLIST_HASH=${allowlistHash}`);
EOF
```

출력된 `export ...` 4줄을 그대로 실행한다.

## 5. Propose Intent

```bash
cd <repo-root>
cast send $INTENT_BOOK_ADDRESS "proposeIntent(bytes32,string,bytes32,(bytes32,uint16,uint256,uint64))" "$INTENT_HASH" "ipfs://intent-demo" "$SNAPSHOT_HASH" "($ALLOWLIST_HASH,$MAX_SLIPPAGE_BPS,$AMOUNT_IN,$DEADLINE)" --rpc-url $RPC_URL --private-key $STRATEGY_PRIVATE_KEY
```

## 6. Create Verifier Signature

```bash
export VERIFIER_ADDRESS=$(cast wallet address --private-key $VERIFIER_PRIVATE_KEY)
export SIG_EXPIRES_AT=$(($(date +%s)+240))
export NONCE=1
node --input-type=module <<'EOF'
import { privateKeyToAccount } from "viem/accounts";
const account = privateKeyToAccount(process.env.VERIFIER_PRIVATE_KEY);
const sig = await account.signTypedData({
  domain: {
    name: "ClawIntentBook",
    version: "1",
    chainId: Number(process.env.CHAIN_ID),
    verifyingContract: process.env.INTENT_BOOK_ADDRESS
  },
  types: {
    IntentAttestation: [
      { name: "intentHash", type: "bytes32" },
      { name: "verifier", type: "address" },
      { name: "expiresAt", type: "uint64" },
      { name: "nonce", type: "uint256" }
    ]
  },
  primaryType: "IntentAttestation",
  message: {
    intentHash: process.env.INTENT_HASH,
    verifier: process.env.VERIFIER_ADDRESS,
    expiresAt: BigInt(process.env.SIG_EXPIRES_AT),
    nonce: BigInt(process.env.NONCE)
  }
});
console.log(`export SIGNATURE=${sig}`);
EOF
```

출력된 `export SIGNATURE=...` 실행.

## 7. Submit Attestation

```bash
cast send $INTENT_BOOK_ADDRESS "attestIntent(bytes32,address[],(uint64,uint256,bytes)[])" "$INTENT_HASH" "[$VERIFIER_ADDRESS]" "[($SIG_EXPIRES_AT,$NONCE,$SIGNATURE)]" --rpc-url $RPC_URL --private-key $STRATEGY_PRIVATE_KEY
```

## 8. Preflight Validation (No State Change)

```bash
export INTENT_HASH=$INTENT_HASH
export TOKEN_IN=$TOKEN_IN
export TOKEN_OUT=$TOKEN_OUT
export AMOUNT_IN=$AMOUNT_IN
export QUOTE_AMOUNT_OUT=$QUOTE_AMOUNT_OUT
export MIN_AMOUNT_OUT=$MIN_AMOUNT_OUT
export ADAPTER=$ADAPTER
export ADAPTER_DATA=$ADAPTER_DATA
export CLAW_CORE_ADDRESS=$CLAW_CORE_ADDRESS
./packages/contracts/scripts/validate-intent-call.sh
```

기대값:
- `approved = true`
- `notExpired = true`
- `notExecuted = true`
- `withinNotional = true`
- `slippageOk = true`
- `allowlistOk = true`

## 8-1. Dry-run Validation (Quote + Failure Code)

```bash
./packages/contracts/scripts/dry-run-intent-call.sh
```

체크 포인트:
- `failureCode == "OK"`
- `quoteOk == true`
- `expectedAmountOut >= MIN_AMOUNT_OUT`

## 9. Approved Status Check

```bash
cast call $INTENT_BOOK_ADDRESS "isIntentApproved(bytes32)(bool)" $INTENT_HASH --rpc-url $RPC_URL
```

## Skillization Note

추후 agent skill로 옮길 때는 아래를 고정 입력으로 설계:
- chain profile (RPC/chainId)
- intent draft schema
- adapterData encoder version
- preflight check gate (`validateIntentExecution` all-true)
