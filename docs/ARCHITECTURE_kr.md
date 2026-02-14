# Claw 아키텍처 (현 구현 기준)

마지막 업데이트: 2026-02-14

## 1. 문서 범위
이 문서는 현재 레포에 실제 구현된 구조를 기준으로 작성합니다.
이상적인 미래 구조가 아니라, 지금 동작하는 기준입니다.

## 2. 구성요소
### 2.1 온체인 컨트랙트
- `ClawFundFactory`: 펀드별 스택 배포
- `IntentBook`: 전략 인텐트 제안 + 검증자 attestation + 임계치 승인
- `ClawCore`: 승인된 인텐트 제약 검증 + 실행
- `ClawVault4626`: 자금 보관/허용 토큰/허용 어댑터/실행
- `NadfunExecutionAdapter`: NadFun buy/sell 어댑터

코드:
- `packages/contracts/src/ClawFundFactory.sol`
- `packages/contracts/src/IntentBook.sol`
- `packages/contracts/src/ClawCore.sol`
- `packages/contracts/src/ClawVault4626.sol`
- `packages/contracts/src/adapters/NadfunExecutionAdapter.sol`

### 2.2 오프체인 Relayer (Next.js)
역할:
- bot 인증/권한
- 펀드/봇 메타데이터 관리
- claim 수집/검증/집계
- epoch state 집계 생성
- intent propose 수신 + executionRoute 정규화
- intent attestation 집계 + 온체인 제출
- execution job 큐 + cron 워커

코드:
- `packages/relayer/app/api/v1/**`
- `packages/relayer/lib/**`

### 2.3 Agents 런타임
- participant CLI: mine -> verify -> submit claim
- strategy 보조 로직: NadFun quote 기반 인텐트 제안 판단

코드:
- `packages/agents/src/skills/participant/index.ts`
- `packages/agents/src/skills/strategy/index.ts`

### 2.4 Protocol SDK
컨트랙트 테스트/relayer/agents가 공통으로 쓰는 단일 규격 레이어.
- canonical hash (`allocationClaimHash`, `intentHash`, `snapshotHash`)
- EIP-712 intent typed data/verify
- weighted threshold 유틸 (intent verifier set)
- execution-route allowlist hash

코드:
- `packages/sdk/src/**`

## 3. 데이터/합의 모델
### 3.1 Claims (현재)
- claim은 relayer DB(Supabase Postgres)에 저장/집계됨.
- claim-level attestation/finalization은 현재 주 경로에서 제거됨.
- participant claim은 strategy의 epoch aggregate 입력으로 사용됨.

### 3.2 Epoch State (현재)
- `POST /api/v1/funds/{fundId}/epochs/{epochId}/aggregate`가 claim으로 epoch state를 생성.
- `GET /api/v1/funds/{fundId}/epochs/latest`가 최신 epoch state를 제공.
- epoch state hash를 `TradeIntent.snapshotHash`에 사용.

### 3.3 Intent (현재)
- strategy bot이 `POST /intents/propose` 호출.
- `executionRoute`는 필수이며 `allowlistHash`는 서버에서 계산.
- verifier attestation 집계 후 threshold 충족 시 `IntentBook.attestIntent(...)` 온체인 제출.
- 승인되면 execution job 생성.

### 3.4 실행 (현재)
- `POST /api/v1/cron/execute-intents`로 워커 실행.
- 워커는 `ClawCore.validateIntentExecution` 선검증 후 `executeIntent` 호출.
- 실행 상태는 `execution_jobs`에 기록.

## 4. API 표면 (v1)
Admin:
- `POST /api/v1/funds`
- `POST /api/v1/funds/bootstrap`

Bots:
- `POST/GET /api/v1/funds/{fundId}/bots/register`
- `POST /api/v1/funds/{fundId}/claims`
- `GET /api/v1/funds/{fundId}/claims`
- `POST /api/v1/funds/{fundId}/epochs/{epochId}/aggregate`
- `GET /api/v1/funds/{fundId}/epochs/latest`
- `POST /api/v1/funds/{fundId}/intents/propose`
- `POST /api/v1/funds/{fundId}/intents/attestations/batch`
- 제거(no-legacy): `POST /attestations`, `GET /snapshots/latest`, `GET /events/claims`

Ops:
- `GET /api/v1/funds/{fundId}/status`
- `GET /api/v1/metrics`
- `GET /api/v1/executions`
- `POST /api/v1/cron/execute-intents`
- SSE: `/events/intents`

## 5. 컨트랙트-릴레이어 결합 포인트
아래 ABI/시그니처가 바뀌면 relayer 동시 수정이 필요함:
- `IntentBook.getIntentExecutionData(...)`
- `IntentBook.attestIntent(...)`
- `ClawCore.validateIntentExecution(...)`
- `ClawCore.executeIntent(...)`

Relayer 호출 지점:
- `packages/relayer/lib/onchain.ts`
- `packages/relayer/lib/executor.ts`

## 6. 미구현/리스크 TODO
- 검증자 스냅샷을 env 기반에서 온체인 소스로 전환.
- dry-run/simulation UX를 relayer/agent 사용자 경로로 제품화.
- strategy 자동화는 현재 BUY 편향(SELL은 규격/컨트랙트 지원, 자동 전략 분기 보강 필요).
- 운영 모니터링/재시도/알림 체계 고도화.

## 7. 운영 기본값
- intent 승인/합의는 `IntentBook` 온체인 기준
- 최종 실행은 relayer executor가 `ClawCore.executeIntent` 호출
