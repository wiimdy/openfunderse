# 현재 구현 상태 및 미구현 TODO (KR)

마지막 업데이트: 2026-02-14

## 1. 현재 동작하는 것
- 펀드 메타 생성/관리 (`/funds`)
- 펀드 온체인 배포+저장 (`/funds/bootstrap`)
- strategy 전용 participant bot 등록 (`/bots/register`)
- claim 제출/조회/attestation 집계
- approved claims 기반 snapshot 생성
- intent propose (`executionRoute` 필수, allowlistHash 서버 계산)
- intent attestation 집계 및 온체인 제출 시도
- execution job 생성/조회/cron 실행
- metrics/status/SSE 제공

## 2. 운영 시 주의사항
- claim 기본 finalize 모드는 OFFCHAIN.
- intent onchain submit/execute는 relayer signer 잔액이 부족하면 실패할 수 있음.
- verifier 주소는 `VERIFIER_WEIGHT_SNAPSHOT`에 반드시 포함되어야 함.

## 3. 미구현/정리 필요
### 3.1 P0
- validator snapshot 소스를 env -> 온체인 소스로 전환
- claim onchain 경로의 위치를 명확히 결정(정식 통합 또는 명시 제거)
- 컨트랙트 ABI 변경 시 relayer 동시 갱신 절차 고정

### 3.2 P1
- strategy 자동 제안 SELL 분기 강화
- dry-run/simulation을 운영 API/CLI 경로로 노출
- execution 장애 시 자동 알림/재시도 정책 강화

### 3.3 P2
- Postman/문서와 실제 운영 runbook의 지속 동기화
- ChatOps UX(명령/상태 템플릿) 고도화

## 4. ABI 변경 영향 포인트
아래가 바뀌면 relayer 수정 필수:
- `IntentBook.getIntentExecutionData(...)`
- `IntentBook.attestIntent(...)`
- `ClawCore.validateIntentExecution(...)`
- `ClawCore.executeIntent(...)`

영향 파일:
- `packages/relayer/lib/onchain.ts`
- `packages/relayer/lib/executor.ts`
