# Claw PRD (현 구현 기준)

마지막 업데이트: 2026-02-14

## 1. 제품 목표
다중 에이전트 펀드 운영 루프를 구현한다.
1. 참가자 봇이 claim을 제출/검증하고,
2. 전략 봇이 제약된 intent를 제안하며,
3. relayer가 weighted attestation을 집계하고,
4. 승인된 intent만 온체인 리스크 룰 하에서 실행한다.

## 2. 현재 구현 범위
### 2.1 컨트랙트
- `ClawFundFactory` 기반 펀드 스택 배포.
- `IntentBook` 기반 합의(`proposeIntent`, `attestIntent`, approved).
- `ClawCore` + `ClawVault4626` 기반 리스크 게이트 실행.
- NadFun 실행 어댑터(`NadfunExecutionAdapter`) 포함.

### 2.2 Relayer
- Supabase/Postgres 저장소 기반.
- Admin API (`/funds`, `/funds/bootstrap`).
- 전략 봇 전용 participant 등록.
- claim 수집/attestation 집계.
- approved claims 기반 snapshot 생성.
- intent propose + intent attestation batch.
- execution queue + cron + execution 조회.
- metrics + SSE 이벤트 제공.

### 2.3 Agents / SDK / Openfunderse
- participant CLI(mine/verify/submit/attest/e2e) 구현.
- strategy quote 기반 propose 보조 로직 구현(현재 BUY 편향).
- SDK를 canonical 규격 소스로 사용(hash, EIP-712, weighted threshold, route hash).
- Openfunderse는 Codex skill/prompt 배포 패키지(실행 런타임은 agents).

## 3. 현재 E2E 운영 플로우
1. Admin이 fund 생성(`/api/v1/funds`) 또는 onchain 배포+저장(`/api/v1/funds/bootstrap`).
2. Strategy bot이 participant bots 등록(`/bots/register`).
3. Crawler bot이 claim 제출(`/claims`).
4. Verifier bot이 claim attestation 제출(`/attestations`).
5. Relayer가 weighted threshold 충족 시 claim finalize(기본 OFFCHAIN).
6. Snapshot 생성(`/snapshots/latest`).
7. Strategy bot이 intent propose(`/intents/propose`, `executionRoute` 필수).
8. Verifier bot이 intent attestation batch 제출.
9. Relayer가 threshold 충족 시 `IntentBook.attestIntent` 온체인 제출.
10. 워커가 `/cron/execute-intents`로 `ClawCore.executeIntent` 실행.
11. `/executions`, `/status`, `/metrics`, SSE로 운영 상태 관찰.

## 4. 현재 정책/제약
- `intents/propose`는 `allowlistHash` 직접 입력 금지.
- relayer가 `executionRoute`로 allowlist hash를 계산/고정.
- executor 호출은 relayer 관리형(현재 permissionless 아님).
- claim finalize 기본 모드는 OFFCHAIN.

## 5. 미구현/보완 필요
- 검증자 스냅샷 소스는 아직 env 기반(온체인 snapshot/registry 연동 필요).
- dry-run UX는 컨트랙트 단위는 있으나 relayer/agent 사용자 경로 통합 미흡.
- claim ONCHAIN 경로는 호환 모드이며 주 스택으로 정렬 필요.
- strategy 자동화는 BUY 중심(SELL 분기 보강 필요).
- 운영 모니터링/자동 알림/장애 대응 고도화 필요.

## 6. 현재 단계 완료 기준
아래가 충족되면 현재 단계 출하 가능:
- fund create/bootstrap 정상
- participant claim e2e 정상
- intent propose + attest 파이프라인 정상
- signer 잔액이 충분할 때 onchain settlement 정상
- status/metrics/executions로 운영 가시성 확보
