# contracts

Foundry contracts (MVP): `IntentBook + Core + Vault + NadFun adapter`.

## Commands

```bash
cd packages/contracts
forge build
forge test
```

## Deploy (Core 운영 스택)

필수 env:
- `RPC_URL`
- `DEPLOYER_PRIVATE_KEY`
- `INTENT_BOOK_ADDRESS` (기존 배포 주소)
- `NADFUN_WMON_ADDRESS`
- `NADFUN_BONDING_CURVE_ROUTER`
- `NADFUN_DEX_ROUTER`

실행:

```bash
cd /Users/ham-yunsig/Documents/github/claw-validation-market
./packages/contracts/scripts/deploy-clawcore-stack.sh
```

출력:
- `/Users/ham-yunsig/Documents/github/claw-validation-market/packages/contracts/.clawcore.deploy.env`
  - `VAULT_ADDRESS`
  - `CORE_ADDRESS`
  - `ADAPTER_ADDRESS`

## Contracts

- `IntentBook.sol`: intent 제안/attest/승인
- `ClawCore.sol`: 승인 intent 집행 오케스트레이션
- `ClawVault4626.sol`: core-gated vault
- `adapters/NadfunExecutionAdapter.sol`: NadFun router 실행

## 최소 집행 플로우

1. `IntentBook.proposeIntent`
2. `IntentBook.attestIntent` (weighted threshold 충족)
3. `ClawCore.validateIntentExecution`으로 사전 유효성 점검
4. `ClawCore.executeIntent` (deadline/replay/maxNotional/allowlist 검증)
5. `ClawVault4626.executeTrade`
6. `NadfunExecutionAdapter`가 NadFun router 호출

## 사전 시뮬레이션(추천)

새로운 intent 포맷/adapterData를 만들 때, 먼저 `eth_call`로 검증:

```bash
INTENT_HASH=0x... \
TOKEN_IN=0x... \
TOKEN_OUT=0x... \
AMOUNT_IN=1000000000000000 \
MIN_AMOUNT_OUT=1 \
ADAPTER=0x... \
ADAPTER_DATA=0x... \
CLAW_CORE_ADDRESS=0x... \
./packages/contracts/scripts/validate-intent-call.sh
```

반환 struct에서 아래를 먼저 확인:
- `approved == true`
- `notExpired == true`
- `notExecuted == true`
- `withinNotional == true`
- `allowlistOk == true`

## 테스트 권장 경로

- 단위/통합: `forge test`
- 실행 전 사전검증: `scripts/validate-intent-call.sh` (`eth_call`)
- 사전검증 통과 후 `executeIntent` 트랜잭션 수행
- 상세 수동 플로우: `docs/protocol/intent-manual-validation.md`
