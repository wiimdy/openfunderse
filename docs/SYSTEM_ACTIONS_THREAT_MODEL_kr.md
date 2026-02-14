# Claw 시스템 구조/행위/위협모델 (KR)

마지막 업데이트: 2026-02-14  
기준 커밋: `14aad2d`

## 1. 범위
이 문서는 현재 저장소 구현 기준으로 다음을 정리한다.
- 전체 구조도 (contracts, relayer API, bots, sdk)
- 행위(Action) 중심 동작 모델
- 위협 모델(신뢰 경계, 위협, 통제, 미해결 갭)
- 구현/미구현 범위

## 2. 전체 구조도
```mermaid
flowchart LR
  A["Admin"] -->|Create/Bootstrap Fund| R["Relayer API (Next.js)"]
  SB["Strategy Bot (AA)"] -->|Register participant bots| R
  CB["Crawler Bot"] -->|Submit Claim| R
  VB["Verifier Bot"] -->|Submit Claim Attestation| R

  R -->|Claim threshold eval (weighted)| DB["Supabase/Postgres"]
  R -->|Build snapshot from approved claims| DB

  SB -->|Propose Intent (executionRoute)| R
  VB -->|Submit Intent Attestations| R
  R -->|READY_FOR_ONCHAIN bundle| SB

  SB -->|AA UserOp: IntentBook.attestIntent| C["Onchain Contracts"]
  SB -->|AA UserOp: ClawCore.executeIntent| C
  SB -->|Ack(attested/executed/failed)| R

  C -->|"IntentBook / ClawCore / ClawVault4626 / Adapter"| N["NadFun Router/Lens"]
```

## 3. 모듈별 책임
### 3.1 Contracts
- `IntentBook`: intent 제안/attestation/approval 합의 레이어
- `ClawCore`: approved intent 검증 + 실행 진입
- `ClawVault4626`: 자금 보관 + 실행 리스크 게이트
- `ClawFundFactory`: 펀드 스택 배포
- `NadfunExecutionAdapter`: NadFun buy/sell 실행 어댑터

주요 파일:
- `packages/contracts/src/IntentBook.sol`
- `packages/contracts/src/ClawCore.sol`
- `packages/contracts/src/ClawVault4626.sol`
- `packages/contracts/src/ClawFundFactory.sol`
- `packages/contracts/src/adapters/NadfunExecutionAdapter.sol`

### 3.2 Relayer API
- 펀드/봇/claim/intent 상태 저장 및 검증
- weighted threshold 집계
- onchain 제출용 bundle/payload 제공
- execution 상태 추적 및 관측 API 제공

주요 파일:
- `packages/relayer/app/api/v1/**`
- `packages/relayer/lib/aggregator.ts`
- `packages/relayer/lib/supabase.ts`

### 3.3 Agents (MoltBot runtime)
- participant: mine/verify/submit/attest
- strategy: intent 결정 + onchain attestation/execute(AA)

주요 파일:
- `packages/agents/src/skills/participant/index.ts`
- `packages/agents/src/skills/strategy/index.ts`
- `packages/agents/src/strategy-cli.ts`

### 3.4 SDK
- canonical hash/정규화
- EIP-712 typed data + verify
- weighted threshold 계산
- execution-route/allowlist hash 계산

주요 파일:
- `packages/sdk/src/hash.ts`
- `packages/sdk/src/eip712.ts`
- `packages/sdk/src/weighted-attestation.ts`
- `packages/sdk/src/relayer-utils.ts`

## 4. Action 카탈로그 (행위 중심)
### 4.1 Admin Actions
- `ADMIN_CREATE_FUND`: `POST /api/v1/funds`
- `ADMIN_BOOTSTRAP_FUND`: `POST /api/v1/funds/bootstrap`

### 4.2 Strategy Actions
- `STRATEGY_REGISTER_BOT`: `POST /api/v1/funds/{fundId}/bots/register`
- `STRATEGY_PROPOSE_INTENT`: `POST /api/v1/funds/{fundId}/intents/propose`
- `STRATEGY_FETCH_ONCHAIN_BUNDLE`: `GET /api/v1/funds/{fundId}/intents/{intentHash}/onchain-bundle`
- `STRATEGY_ATTEST_ONCHAIN`: Strategy AA가 `IntentBook.attestIntent` 제출
- `STRATEGY_EXECUTE_ONCHAIN`: Strategy AA가 `ClawCore.executeIntent` 제출
- `STRATEGY_ACK_RESULT`: onchain 결과를 relayer에 ack

### 4.3 Participant Actions
- `CRAWLER_SUBMIT_CLAIM`: `POST /api/v1/funds/{fundId}/claims`
- `VERIFIER_ATTEST_CLAIM`: `POST /api/v1/funds/{fundId}/attestations`
- `VERIFIER_ATTEST_INTENT`: `POST /api/v1/funds/{fundId}/intents/attestations/batch`

### 4.4 Observe/Ops Actions
- `READ_STATUS`: `GET /api/v1/funds/{fundId}/status`
- `READ_METRICS`: `GET /api/v1/metrics`
- `READ_EXECUTIONS`: `GET /api/v1/executions`
- `SSE_CLAIMS`: `GET /api/v1/funds/{fundId}/events/claims`
- `SSE_INTENTS`: `GET /api/v1/funds/{fundId}/events/intents`

## 5. 현재 E2E 동작 순서
1. Admin fund 생성 또는 bootstrap
2. Strategy bot이 participant bot 등록
3. Crawler claim 제출
4. Verifier claim attestation 제출
5. Relayer weighted threshold 판정 후 claim finalize (기본 OFFCHAIN)
6. approved claims로 snapshot 생성
7. Strategy intent propose (`executionRoute` 필수, allowlistHash는 relayer 계산)
8. Verifier intent attestation batch 제출
9. intent가 `READY_FOR_ONCHAIN`이면 Strategy AA가 bundle 조회
10. Strategy AA가 `IntentBook.attestIntent` 온체인 제출
11. Strategy AA가 `ClawCore.executeIntent` 온체인 실행
12. 성공/실패 ack 후 execution/status/metrics/SSE로 관측

## 6. 위협 모델링
## 6.1 자산(Assets)
- Vault 자금
- Intent 승인 상태
- Attestation 서명 데이터
- Bot API 키 / Admin 세션 / AA owner key
- Relayer 상태 DB

## 6.2 신뢰 경계(Trust Boundaries)
- Bot <-> Relayer API
- Relayer <-> Supabase
- Relayer/Strategy <-> Onchain RPC/Bundler
- Onchain contracts <-> External venue (NadFun)

## 6.3 주요 위협/통제/갭
1. 위조/재사용 attestation 제출
- 통제: EIP-712 검증, nonce/expiry, 중복 제거
- 갭: verifier snapshot source가 아직 env 기반

2. 승인되지 않은 intent 실행 시도
- 통제: `IntentBook` 승인 체크 + `ClawCore.validateIntentExecution`
- 갭: relayer 표준 dry-run API/운영 UX 미완성

3. relayer 단일 장애/오동작
- 통제: 최종 승인/집행은 온체인 정책 통과 필요, ack 기반 상태 추적
- 갭: 알림/자동 복구 runbook 자동화 미흡

4. 키/권한 오남용
- 통제: admin 세션 분리, bot scope 분리
- 갭: 운영 키 로테이션/감사 자동화 부족

5. ABI 변경으로 relayer-계약 불일치
- 통제: SDK 중심 규격 통합
- 갭: 계약 변경 시 relayer 동시 검증 파이프라인 강화 필요

## 7. 구현 현황
## 7.1 구현됨
- intent onchain 합의 + 실행 파이프라인
- relayer supabase 저장/상태머신
- participant/strategy runtime 기본 경로
- SDK canonical/EIP-712/weighted 유틸
- relayer API/Postman 기본 시나리오

## 7.2 미구현/부분구현
- validator snapshot onchain source 전환 (현재 env 기반)
- relayer dry-run 전용 API 표준화
- claim onchain 경로 정식 정렬 (현재 호환 모드)
- indexer/dashboard/fundops/crawhub 독립 완성

## 8. 문서 정합성 주의
- `docs/VERCEL_INTEGRATION_RUNBOOK_kr.md`에는 일부 과거 스캐폴드 표현(`501`)이 남아 있어, 현재 구현과 불일치 가능성이 있다.
- 운영 전 runbook 문서와 실제 API 구현의 최신 동기화가 필요하다.
