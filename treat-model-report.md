# Treat Model Report (2026-02-14)

## 0) 이번 업데이트 반영 요약
- `participant` 단일 역할로 크롤링+검증(attestation) 경로가 통합되었습니다.
  - `POST /funds/{fundId}/claims`는 `allowedRoles: ["participant"]`로 제한됩니다. (`/Users/wiimdy/agent/packages/relayer/app/api/v1/funds/[fundId]/claims/route.ts:33`)
  - `POST /funds/{fundId}/attestations`, `POST /funds/{fundId}/intents/attestations/batch`도 `participant`만 허용됩니다. (`/Users/wiimdy/agent/packages/relayer/app/api/v1/funds/[fundId]/attestations/route.ts:17`, `/Users/wiimdy/agent/packages/relayer/app/api/v1/funds/[fundId]/intents/attestations/batch/route.ts:17`)
- 전략 봇 권한 경계가 명확해졌습니다.
  - participant 등록은 strategy 전용이며 role도 `participant`만 허용됩니다. (`/Users/wiimdy/agent/packages/relayer/app/api/v1/funds/[fundId]/bots/register/route.ts:5`)
  - intent 제안/온체인 ACK 계열은 strategy role 전용입니다. (`/Users/wiimdy/agent/packages/relayer/app/api/v1/funds/[fundId]/intents/propose/route.ts:32`)
- 전략 실행 품질 관련 코드가 강화되었습니다.
  - 전략 의사결정은 BUY/SELL 모두 지원합니다. (`/Users/wiimdy/agent/packages/agents/src/skills/strategy/index.ts:675`)
  - 실행 직전 `dryRunIntentExecution` 게이트를 통과하지 못하면 실패 ACK 후 재시도 큐로 보냅니다. (`/Users/wiimdy/agent/packages/agents/src/strategy-cli.ts:614`)
- Relayer 내장 cron 실행은 keyless 모드에서 비활성입니다.
  - `/cron/execute-intents`는 410 반환으로 전략 signer bot 실행을 강제합니다. (`/Users/wiimdy/agent/packages/relayer/app/api/v1/cron/execute-intents/route.ts:21`)

## 1) 엔티티별 기능/함수/상호작용

### E1. Admin (웹 세션 운영자)
- 핵심 목적: 펀드 생성/검증/부트스트랩.
- 핵심 함수/엔드포인트:
  - `requireAdminSession()` (`/Users/wiimdy/agent/packages/relayer/lib/authz.ts:27`)
  - `POST /api/v1/funds` (`/Users/wiimdy/agent/packages/relayer/app/api/v1/funds/route.ts:62`)
  - `POST /api/v1/funds/bootstrap` (`/Users/wiimdy/agent/packages/relayer/app/api/v1/funds/bootstrap/route.ts:82`)
  - `POST /api/v1/funds/{fundId}/verify` (`/Users/wiimdy/agent/packages/relayer/app/api/v1/funds/[fundId]/verify/route.ts:5`)
- 상호작용:
  - Relayer -> Supabase(`upsertFund`, `upsertFundBot`, `upsertFundDeployment`)로 운영 상태를 고정.
  - bootstrap 시 Onchain Factory/receipt 검사까지 수행.

### E2. Strategy Bot (펀드 전략 주체)
- 핵심 목적: participant 관리, intent 제안, 온체인 ACK.
- 핵심 함수/엔드포인트:
  - `requireBotAuthAsync(..., ["intents.propose"|"bots.register"|"funds.bootstrap"])` (`/Users/ham-yunsig/Documents/github/claw-validation-market/packages/relayer/lib/bot-auth.ts`)
  - `requireFundBotRole(..., allowedRoles:["strategy"])` (`/Users/wiimdy/agent/packages/relayer/lib/fund-bot-authz.ts:37`)
  - `POST /intents/propose` (`/Users/wiimdy/agent/packages/relayer/app/api/v1/funds/[fundId]/intents/propose/route.ts:23`)
  - `GET /intents/{intentHash}/onchain-bundle` (`/Users/wiimdy/agent/packages/relayer/app/api/v1/funds/[fundId]/intents/[intentHash]/onchain-bundle/route.ts:6`)
  - `POST /intents/{intentHash}/onchain-attested` (`/Users/wiimdy/agent/packages/relayer/app/api/v1/funds/[fundId]/intents/[intentHash]/onchain-attested/route.ts:15`)
  - `POST /intents/{intentHash}/onchain-executed` (`/Users/wiimdy/agent/packages/relayer/app/api/v1/funds/[fundId]/intents/[intentHash]/onchain-executed/route.ts:14`)
  - `POST /intents/{intentHash}/onchain-failed` (`/Users/wiimdy/agent/packages/relayer/app/api/v1/funds/[fundId]/intents/[intentHash]/onchain-failed/route.ts:15`)
  - `POST /funds/{fundId}/bots/register` (`/Users/wiimdy/agent/packages/relayer/app/api/v1/funds/[fundId]/bots/register/route.ts:7`)
  - `POST /funds/sync-by-strategy` (`/Users/wiimdy/agent/packages/relayer/app/api/v1/funds/sync-by-strategy/route.ts:125`)
- 상호작용:
  - 전략 봇은 펀드의 `strategy_bot_id`와 일치해야 intent/등록 권한을 획득.
  - 제안 시 `executionRoute`와 intent 필드를 일치 검증하고 allowlist hash를 서버에서 계산.

### E3. Participant Bot (크롤링 + 검증 통합)
- 핵심 목적: claim 제출 + claim/intent attestation 수행.
- 핵심 함수/엔드포인트:
  - `POST /claims` (`/Users/wiimdy/agent/packages/relayer/app/api/v1/funds/[fundId]/claims/route.ts:15`)
  - `POST /attestations` (`/Users/wiimdy/agent/packages/relayer/app/api/v1/funds/[fundId]/attestations/route.ts:6`)
  - `POST /intents/attestations/batch` (`/Users/wiimdy/agent/packages/relayer/app/api/v1/funds/[fundId]/intents/attestations/batch/route.ts:6`)
  - `claimPayload.crawler`/`verifier` 주소가 등록된 bot address와 일치해야 통과. (`/Users/wiimdy/agent/packages/relayer/app/api/v1/funds/[fundId]/claims/route.ts:67`, `/Users/wiimdy/agent/packages/relayer/app/api/v1/funds/[fundId]/attestations/route.ts:33`)
- 상호작용:
  - 단일 participant 키가 claim + attest 둘 다 가능하므로 운영 단순화가 되었지만, 키 유출 시 영향 범위가 넓어짐.

### E4. Relayer Auth/AuthZ 레이어
- 핵심 함수:
  - `requireBotAuthAsync()` (`/Users/ham-yunsig/Documents/github/claw-validation-market/packages/relayer/lib/bot-auth.ts`)
  - `requireFundBotRole()` / `isSameAddress()` (`/Users/wiimdy/agent/packages/relayer/lib/fund-bot-authz.ts:37`)
  - `requireAdminSession()` (`/Users/wiimdy/agent/packages/relayer/lib/authz.ts:27`)
- 상호작용:
  - 모든 쓰기 API의 첫 경계.
  - (권장) Supabase `bot_credentials`에 등록된 key/scopes + 펀드 멤버십 role 체크가 결합되어야 통과.
  - (레거시 fallback) `BOT_API_KEYS` + `BOT_SCOPES` env로도 통과 가능.

### E5. Aggregator / 상태전이 엔진
- 핵심 함수:
  - `ingestClaimAttestation()` (`/Users/wiimdy/agent/packages/relayer/lib/aggregator.ts:159`)
  - `ingestIntentAttestation()` (`/Users/wiimdy/agent/packages/relayer/lib/aggregator.ts:299`)
  - `maybeFinalizeSubject()` (`/Users/wiimdy/agent/packages/relayer/lib/aggregator.ts:73`)
- 상호작용:
  - EIP-712 검증 -> 가중치 누적 -> threshold 충족 시 상태 전이.
  - intent는 `READY_FOR_ONCHAIN`으로 전이시키고 strategy signer bot이 온체인 제출.

### E6. Supabase (데이터 평면)
- 핵심 함수:
  - `upsertSubjectState`, `insertAttestation`, `markIntentReadyForOnchain`, `markSubjectApproved`, `markExecutionJobExecutedByIntent` (`/Users/wiimdy/agent/packages/relayer/lib/supabase.ts:494`, `:451`, `:695`, `:615`, `:1314`)
- 핵심 스키마:
  - `subject_state` unique `(subject_type, subject_hash)` (`/Users/wiimdy/agent/packages/relayer/supabase/schema.sql:90`)
  - `attestations` unique `(subject_type, subject_hash, verifier)` (`/Users/wiimdy/agent/packages/relayer/supabase/schema.sql:73`)
- 상호작용:
  - relayer API와 aggregator의 단일 상태 소스.
  - multi-fund 환경에서 subject unique 키가 `fund_id`를 포함하지 않아 교차 펀드 충돌 리스크 잔존.

### E7. Strategy Agent/CLI (Web2 실행기)
- 핵심 함수:
  - `proposeIntent()` BUY/SELL 의사결정 (`/Users/wiimdy/agent/packages/agents/src/skills/strategy/index.ts:675`)
  - `runStrategyAttestOnchain()` (`/Users/wiimdy/agent/packages/agents/src/strategy-cli.ts:442`)
  - `runStrategyExecuteReady()` (`/Users/wiimdy/agent/packages/agents/src/strategy-cli.ts:570`)
  - `RelayerClient.*` API 래퍼 (`/Users/wiimdy/agent/packages/agents/src/lib/relayer-client.ts:260`)
- 상호작용:
  - `dryRunIntentExecution` 실패 시 즉시 `onchain-failed` ACK로 재시도 큐 처리.
  - `isIntentApproved` 온체인 확인 후에만 `onchain-attested` ACK.

### E8. ClawFundFactory (온체인 펀드 스택 배포자)
- 핵심 함수:
  - `createFund()` (`/Users/wiimdy/agent/packages/contracts/src/ClawFundFactory.sol:90`)
- 상호작용:
  - UUPS proxy( IntentBook/Core/Vault ) 배포 및 초기 설정 후 ownership을 `fundOwner`로 이관.

### E9. IntentBook (온체인 intent 승인 원장)
- 핵심 함수:
  - `proposeIntent()` (`/Users/wiimdy/agent/packages/contracts/src/IntentBook.sol:164`)
  - `attestIntent()` (`/Users/wiimdy/agent/packages/contracts/src/IntentBook.sol:185`)
  - `isIntentApproved()` (`/Users/wiimdy/agent/packages/contracts/src/IntentBook.sol:230`)
  - `getIntentExecutionData()` (`/Users/wiimdy/agent/packages/contracts/src/IntentBook.sol:239`)
  - `freezeConfig()`, `freezeUpgrades()` (`/Users/wiimdy/agent/packages/contracts/src/IntentBook.sol:152`, `:158`)
- 상호작용:
  - strategyAgent 제안 + verifier 서명 가중치가 threshold 도달 시 승인.

### E10. ClawCore (온체인 실행 오케스트레이터)
- 핵심 함수:
  - `validateIntentExecution()` (`/Users/wiimdy/agent/packages/contracts/src/ClawCore.sol:256`)
  - `dryRunIntentExecution()` (`/Users/wiimdy/agent/packages/contracts/src/ClawCore.sol:295`)
  - `executeIntent()` (`/Users/wiimdy/agent/packages/contracts/src/ClawCore.sol:229`)
  - `freezeConfig()`, `freezeUpgrades()` (`/Users/wiimdy/agent/packages/contracts/src/ClawCore.sol:217`, `:223`)
- 상호작용:
  - IntentBook 제약 + Vault allowlist + Adapter quote 조건을 종합 검증 후 실행.

### E11. ClawVault4626 (자산 보관/체결 계층)
- 핵심 함수:
  - `executeTrade()` (`/Users/wiimdy/agent/packages/contracts/src/ClawVault4626.sol:556`)
  - `setTokenAllowed()`, `setAdapterAllowed()` (`/Users/wiimdy/agent/packages/contracts/src/ClawVault4626.sol:220`, `:226`)
  - `freezeConfig()`, `freezeUpgrades()` (`/Users/wiimdy/agent/packages/contracts/src/ClawVault4626.sol:282`, `:288`)
- 상호작용:
  - `onlyCore`로만 거래 실행 허용.
  - 포지션 존재 시 share 입출금 차단(`ShareOpsBlockedWithOpenPositions` 경로).

### E12. NadfunExecutionAdapter (NadFun 실행 어댑터)
- 핵심 함수:
  - `execute()` BUY/SELL (`/Users/wiimdy/agent/packages/contracts/src/adapters/NadfunExecutionAdapter.sol:87`)
  - `quote()` (`/Users/wiimdy/agent/packages/contracts/src/adapters/NadfunExecutionAdapter.sol:102`)
  - `freezeUpgrades()` (`/Users/wiimdy/agent/packages/contracts/src/adapters/NadfunExecutionAdapter.sol:79`)
- 상호작용:
  - Lens `getAmountOut`로 router/amountOutMin 일치 검증.
  - BUY는 WMON->MON unwrap 후 router buy, SELL은 sell 후 native를 WMON 재랩하여 vault로 반환.

### E13. Public Read/SSE 소비자
- 핵심 엔드포인트:
  - `GET /api/v1/executions` (`/Users/wiimdy/agent/packages/relayer/app/api/v1/executions/route.ts:16`)
  - `GET /api/v1/metrics` (`/Users/wiimdy/agent/packages/relayer/app/api/v1/metrics/route.ts:4`)
  - SSE claims/intents (`/Users/wiimdy/agent/packages/relayer/app/api/v1/funds/[fundId]/events/claims/route.ts:6`, `/Users/wiimdy/agent/packages/relayer/app/api/v1/funds/[fundId]/events/intents/route.ts:6`)
- 상호작용:
  - 현재 공개 조회 경로로 동작하며, 운영 메타데이터 노출/연결수 증가 리스크가 존재.

## 2) 함수 기반 상호작용 시퀀스
1. Admin이 `POST /funds` 또는 `POST /funds/bootstrap`으로 펀드 메타데이터/온체인 배포를 고정.
2. Strategy bot이 `POST /funds/{fundId}/bots/register`로 participant를 등록.
3. Participant bot이 `POST /claims`로 claim 등록.
4. Participant bot이 `POST /attestations`로 claim attestation 제출 -> `ingestClaimAttestation()`이 threshold 계산.
5. `GET /snapshots/latest`가 승인된 claim 집합으로 최신 snapshot hash를 생성/갱신.
6. Strategy bot이 `POST /intents/propose`로 intent + executionRoute 제출(allowlist hash 서버 계산).
7. Participant bot이 `POST /intents/attestations/batch` 제출 -> `ingestIntentAttestation()`에서 threshold 충족 시 `READY_FOR_ONCHAIN`.
8. Strategy signer bot이 `GET /intents/{hash}/onchain-bundle`을 받아 `IntentBook.attestIntent()` 호출.
9. Strategy signer bot이 `IntentBook.isIntentApproved()`를 확인 후 `POST /onchain-attested` ACK.
10. Strategy signer bot이 `GET /intents/ready-execution` -> `ClawCore.dryRunIntentExecution()` 통과 시 `ClawCore.executeIntent()` 호출.
11. 성공 시 `POST /onchain-executed`, 실패 시 `POST /onchain-failed`로 relayer 상태 동기화.

## 3) 위협 모델 업데이트 (현재 코드 기준)

### 이미 개선된 부분
- participant 단일화로 role mismatch 에러 클래스가 줄었고, 운영 플레이북(Postman/README/.env.example)도 동일 모델로 정렬됨.
  - `/Users/wiimdy/agent/packages/relayer/postman/README.md:85`
  - `/Users/wiimdy/agent/packages/relayer/.env.example:43`
- 전략 실행 루프에서 `dryRunIntentExecution` 사용으로 불필요한 온체인 실패 트랜잭션이 줄어드는 구조.
  - `/Users/wiimdy/agent/packages/agents/src/strategy-cli.ts:614`

### 남아 있는 주요 리스크
- 교차 펀드 subject 충돌 리스크:
  - DB unique가 `fund_id` 미포함(`subject_state`, `attestations`)이며, 일부 업데이트 쿼리가 `fund_id` 없이 동작.
  - 근거: `/Users/wiimdy/agent/packages/relayer/supabase/schema.sql:73`, `/Users/wiimdy/agent/packages/relayer/supabase/schema.sql:90`, `/Users/wiimdy/agent/packages/relayer/lib/supabase.ts:507`
- 온체인 ACK 무결성 리스크:
  - `onchain-attested`, `onchain-executed`는 txHash 형식/상태만 검사하고 체인 receipt/event 연계 검증은 하지 않음.
  - 근거: `/Users/wiimdy/agent/packages/relayer/app/api/v1/funds/[fundId]/intents/[intentHash]/onchain-attested/route.ts:47`, `/Users/wiimdy/agent/packages/relayer/app/api/v1/funds/[fundId]/intents/[intentHash]/onchain-executed/route.ts:43`
- 공개 read/SSE 노출:
  - metrics/executions/SSE는 인증 없는 접근 경로로 운영 메타데이터 노출 가능.
  - 근거: `/Users/wiimdy/agent/packages/relayer/app/api/v1/metrics/route.ts:4`, `/Users/wiimdy/agent/packages/relayer/app/api/v1/executions/route.ts:16`
- 관리자/소유자 집중 리스크:
  - UUPS 업그레이드 + allowlist 변경 권한이 owner에 집중되어 governance compromise 시 자산 위험.
  - 근거: `/Users/wiimdy/agent/packages/contracts/src/ClawCore.sol:384`, `/Users/wiimdy/agent/packages/contracts/src/ClawVault4626.sol:822`, `/Users/wiimdy/agent/packages/contracts/src/IntentBook.sol:312`

## 4) 우선순위 패치 제안
1. DB tenant-isolation 보강
   - `subject_state`/`attestations` unique를 `(fund_id, subject_type, subject_hash...)` 형태로 마이그레이션.
   - `upsertSubjectState`, `incrementSubjectAttestedWeight`, `markSubjectSubmitError` 등 조회/업데이트 조건에 `fund_id` 강제.
2. ACK 체인검증 강제
   - `onchain-attested`/`onchain-executed`에서 tx receipt + expected event(intentHash) 확인 후 상태 전이.
3. 공개 read 경로 정책 분리
   - 운영용 endpoint는 인증 또는 redacted 응답으로 분리.
4. 거버넌스 하드닝
   - 배포 후 `freezeConfig`/`freezeUpgrades` 실행 절차를 runbook으로 강제하고 모니터링 이벤트 알림 구성.

---
첨부 다이어그램 파일: `/Users/wiimdy/agent/treat-model-report.excalidraw`
