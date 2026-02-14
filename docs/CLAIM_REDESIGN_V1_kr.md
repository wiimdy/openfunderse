# Claim 재설계 v1 (No-Legacy, 현재 수식 기준)

마지막 업데이트: 2026-02-14

## 0. 결정 사항
- 레거시 `crawl/evidence` claim 모델은 유지하지 않는다.
- claim은 "참가자의 포트폴리오 비중 전망"으로 재정의한다.
- 합의/보상 기준은 루트 `README.md`의 `Consensus Rebalancing Model (Risk-Projected Aggregation)` 수식을 단일 기준으로 사용한다.
- 단계별 마이그레이션이 아닌, 새 스키마/새 API/새 정산 경로로 일괄 전환한다.

## 1. 새 Claim 정의

## 1.1 의미
- 기존: 외부 데이터 추출 결과(텍스트/크롤링 증거)
- 변경: 참가자 i가 epoch t에 제출하는 타겟 비중 벡터 `c_{i,t} \in \Delta^n`

## 1.2 최소 페이로드(v1)
```ts
interface AllocationClaimV1 {
  claimVersion: "v1";
  fundId: string;
  epochId: bigint;
  participant: Address;      // bot address
  targetWeights: bigint[];   // fixed-point, sum == SCALE
  horizonSec: bigint;        // H
  nonce: bigint;
  submittedAt: bigint;
}
```

정합성 규칙:
- `targetWeights.length == whitelist asset count`
- 각 원소 `>= 0`
- `sum(targetWeights) == SCALE`
- `participant`는 등록된 participant bot address와 일치
- `(fundId, epochId, participant, nonce)` 유니크

## 1.3 해시/서명
- `claimHash`는 위 payload의 ABI-encode 해시로 재정의
- 기존 `ClaimPayload(schemaId/sourceRef/extracted/...)` 기반 hash 제거
- claim attestation은 v1에서 제거 (필요 시 v2에 검증자 모델 재도입)

## 2. Epoch 파이프라인(새 표준)
1. `AllocationClaimV1` 수집
2. stake 가중 집계: `\bar{s}_t = \sum_i w_{i,t} c_{i,t}`
3. risk projection: `s_t^\star = \Pi_{\mathcal R_t}(\bar s_t)`
4. strategy execution: `s_t \to s_{t+1}`
5. oracle return 산출: `r_t^H`
6. participant score: `g_{i,t}=(c_{i,t}-s_t^\star)^\top r_t^H`
7. stake update + mint allocation

운영 원칙:
- projection/score/oracle aggregation은 offchain(relayer/strategy)
- settlement constraint/asset movement/mint는 onchain

## 3. 패키지별 변경 계획 (정확 파일 기준)

## 3.1 packages/sdk
목표: 타입/해시 표준을 새 claim으로 교체

필수 변경:
- `packages/sdk/src/types.ts`
  - `ClaimPayload` 제거
  - `AllocationClaimV1`/`EpochStateV1`/`ScoreSettlementV1` 추가
- `packages/sdk/src/canonical.ts`
  - claim canonicalizer를 targetWeights 기반으로 교체
- `packages/sdk/src/hash.ts`
  - `claimHash(payload: ClaimPayload)` 제거
  - `allocationClaimHash(claim: AllocationClaimV1)` 추가
  - `snapshotHash`는 `epochStateHash`로 이름/의미 변경 권장
- `packages/sdk/src/relayer-utils.ts`
  - `buildCanonicalClaimRecord`를 `buildCanonicalAllocationClaimRecord`로 교체
  - snapshot builder를 epoch-state builder로 교체
- `packages/sdk/src/eip712.ts`, `packages/sdk/src/attestation*.ts`
  - claim attestation 도메인/타입 제거

테스트 교체:
- `packages/sdk/test/hash.test.mjs`
- `packages/sdk/test/vectors.json`
- `packages/sdk/test/relayer-utils.test.mjs`
- `packages/sdk/test/eip712.test.mjs`

## 3.2 packages/relayer
목표: claim+attestation+snapshot API를 epoch claim aggregation API로 전환

필수 변경:
- 라우트 교체
  - 삭제: `packages/relayer/app/api/v1/funds/[fundId]/claims/route.ts`
  - 삭제: `packages/relayer/app/api/v1/funds/[fundId]/attestations/route.ts`
  - 삭제: `packages/relayer/app/api/v1/funds/[fundId]/snapshots/latest/route.ts`
  - 신규(권장):
    - `.../allocations/claims/route.ts` (submit/list)
    - `.../allocations/epochs/[epochId]/aggregate/route.ts`
    - `.../allocations/epochs/[epochId]/settle/route.ts`
- 집계 로직
  - `packages/relayer/lib/aggregator.ts`: weighted-attestation 기반 분기 제거, epoch aggregation/score settlement 로직으로 교체
- 설정
  - `packages/relayer/lib/config.ts`: `CLAIM_*`, `CLAIM_FINALIZATION_MODE` 제거
  - oracle/benchmark/score 파라미터 env 추가 (`ORACLE_*`, `SCORE_CLIP_B`, `ETA`, `MU` 등)
- 저장소
  - `packages/relayer/lib/supabase.ts`: claims/attestations/snapshots 접근 제거
  - allocation claims / epoch states / settlements 접근 함수 추가
- 스키마
  - `packages/relayer/supabase/schema.sql`:
    - 삭제: `claims`, `attestations`, `subject_state`, `snapshots` (또는 drop + 신규 테이블)
    - 신규: `allocation_claims`, `epoch_states`, `score_settlements`, `stake_weights`, `mint_distributions`
- 실행 연동
  - `packages/relayer/lib/executor.ts`, `packages/relayer/lib/onchain.ts`: `snapshotHash` 의존 제거/치환

보조 변경:
- `packages/relayer/.env.example`
- `packages/relayer/README.md`
- `packages/relayer/scripts/smoke-all-apis.mjs`
- `packages/relayer/postman/*`

## 3.3 packages/contracts
목표: snapshot finality 의존 제거 + reward mint 정산 경로 추가

필수 변경:
- `packages/contracts/src/IntentBook.sol`
  - `ISnapshotBook` 의존 제거
  - `snapshotHash` 필드를 `epochStateHash` 또는 `roundHash`로 치환
  - `proposeIntent` precondition을 새 epoch finality source로 교체
- `packages/contracts/src/ClawCore.sol`
  - execution validation 데이터의 `snapshotHash`를 새 해시 필드로 치환
- `packages/contracts/src/ClawVault4626.sol`
  - participant reward mint를 위한 owner/core 권한 엔트리포인트 추가
  - `M_t` 분배 반영 함수(배열/merkle 기반) 추가

테스트 교체:
- `packages/contracts/test/IntentBook.t.sol`
- `packages/contracts/test/ClawCoreVault.t.sol`
- `packages/contracts/test/ClawFundFactory.t.sol`
- script: `packages/contracts/script/RunIntentBuyE2E.s.sol`, `DeployClawIntentStack.s.sol`

## 3.4 packages/agents
목표: crawl 기반 participant를 allocation claim 제출 에이전트로 전환

필수 변경:
- `packages/agents/src/participant-cli.ts`
  - `mine/verify/attest_claim` 명령 제거
  - `submit_allocation_claim`, `settle_epoch_preview` 명령 추가
- `packages/agents/src/skills/participant/index.ts`
  - claim mining/evidence 검증 제거
  - targetWeights 생성/검증/제출 로직 추가
- `packages/agents/src/lib/relayer-client.ts`
  - `/claims`, `/attestations`, `/snapshots/latest` 클라이언트 제거
  - 새 allocation/epoch endpoints 추가
- `packages/agents/src/skills/strategy/index.ts`
  - `snapshot.finalized`, `claimCount` 전제 제거
  - epoch aggregate/target state 입력 기준으로 제안

보조 변경:
- `packages/agents/README.md`, `packages/agents/ER2_RUNBOOK.md`, `packages/agents/.env.example`

## 3.5 packages/openfunderse
목표: Skill/Prompt를 새 claim semantics로 동기화

필수 변경:
- `packages/openfunderse/packs/openfunderse/skills/participant/SKILL.md`
- `packages/openfunderse/packs/openfunderse/skills/strategy/SKILL.md`
- `packages/openfunderse/packs/openfunderse/skills/relayer/SKILL.md`
- `packages/openfunderse/packs/openfunderse/prompts/participant/system.md`
- `packages/openfunderse/packs/openfunderse/prompts/strategy/system.md`
- `packages/openfunderse/packs/openfunderse/prompts/core/system.md`

변경 포인트:
- claim=데이터마이닝 서술 제거
- claim=portfolio target weight assertion으로 전면 교체

## 3.6 docs
필수 문서 갱신:
- `README.md` (이미 수식 기준 반영됨)
- `docs/PRD_kr.md`
- `docs/CURRENT_STATUS_kr.md`
- `docs/protocol/hashing-eip712-v1.md` (hash spec 전면 교체)
- 운영/runbook/postman 문서 전면 교체

## 4. 구현 순서(문서 기준 고정)
1. SDK 타입/해시 스펙 변경
2. Relayer DB 스키마 + 저장소 계층 교체
3. Relayer API 라우트 교체
4. Agents CLI/skills 교체
5. Contracts 인터페이스/저장필드 교체
6. E2E 스모크/문서/프롬프트 동기화

이 순서를 고정하는 이유:
- SDK가 모든 계층의 canonical source
- DB/API를 먼저 바꿔야 agent/contracts adapter가 의미 있게 붙음

## 5. 완료 기준(Definition of Done)
- 레거시 claim 필드(`sourceRef/extracted/evidenceURI`)가 코드/DB/API에서 완전히 제거됨
- `/claims`, `/attestations`, `/snapshots/latest` 경로 제거 또는 410 반환
- participant는 `targetWeights` claim만 제출 가능
- epoch settle 후 `w_{i,t+1}` 및 `\Delta N_{i,t}` 결과가 재현 가능(동일 입력 -> 동일 출력)
- 온체인 민팅 반영량 합이 `M_t`와 일치
- 문서/SDK 테스트/relayer 스모크/E2E가 새 모델 기준으로 통과

## 6. 리스크와 제약
- no-legacy 전환이므로 기존 데이터/스크립트/포스트맨은 즉시 깨진다.
- contracts 인터페이스 변경으로 배포 스택(Factory 포함) 재배포 가능성이 높다.
- score/oracle 계산이 offchain인 동안에는 relayer 결정론/감사로그를 강제해야 한다.
