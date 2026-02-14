# ChatOps 아키텍처 (현 구현 기준)

마지막 업데이트: 2026-02-14

## 1. 현재 ChatOps 의미
채팅방/봇이 운영 흐름을 만들지만, 실제 강제력은 컨트랙트와 relayer 정책이 담당합니다.

현재 경로:
- participant 봇이 claim 제출
- strategy 봇이 epoch aggregate 생성
- strategy 봇이 intent 제안
- relayer가 서명 집계
- threshold 충족 시 intent attestation을 온체인 반영
- cron 워커가 `ClawCore` 실행

## 2. 런타임 구성
- 채팅/봇 런타임: `packages/agents`
- relayer API/오케스트레이션: `packages/relayer`
- 온체인 실행 레이어: `packages/contracts`
- 공통 프로토콜 규격: `packages/sdk`
- skill 배포 패키지: `packages/openfunderse`

## 3. 현재 운영 시퀀스
1. Admin이 fund create/bootstrap.
2. Strategy bot이 participant bots 등록.
3. Crawler bot이 claim 제출.
4. Strategy bot이 epoch aggregate 생성.
5. Relayer가 최신 epoch state 제공.
7. Strategy bot이 executionRoute 포함 intent propose.
8. Verifier bot이 intent attestation 제출.
9. Relayer가 `IntentBook.attestIntent` 온체인 제출.
10. execution cron이 `ClawCore.executeIntent` 실행.

## 4. Bot-Relayer API 계약
봇 필수 API:
- `/api/v1/funds/{fundId}/claims`
- `/api/v1/funds/{fundId}/epochs/{epochId}/aggregate`
- `/api/v1/funds/{fundId}/epochs/latest`
- `/api/v1/funds/{fundId}/intents/propose`
- `/api/v1/funds/{fundId}/intents/attestations/batch`
- `/api/v1/funds/{fundId}/events/intents` (SSE)

운영자 API:
- `/api/v1/funds`
- `/api/v1/funds/bootstrap`
- `/api/v1/executions`
- `/api/v1/cron/execute-intents`
- `/api/v1/funds/{fundId}/status`
- `/api/v1/metrics`

## 5. 미구현/갭
- validator snapshot이 아직 env 기반(온체인 소스 연동 필요).
- strategy 자동화는 BUY 편향, SELL 자동 분기 보강 필요.
- claim attestation/snapshot 레거시 엔드포인트는 제거(no-legacy) 상태.
- 운영 알림/장애 대응 자동화는 TODO.
