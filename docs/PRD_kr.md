# Openfunderse PRD (Claim 재설계 기준)

마지막 업데이트: 2026-02-14

## 1. 제품 목표
Openfunderse는 참가자의 "자산 비중 전망(claim)"을 집계해 펀드 리밸런싱을 결정하고, 사후 성과에 따라 stake/보상을 업데이트하는 에이전트 기반 펀드 프로토콜이다.

핵심 목표:
1. 참가자 claim을 `c_{i,t} \in \Delta^n` 형태로 표준화
2. stake 가중 집계 + risk projection으로 목표 비중 `s_t^\star` 산출
3. 실행 결과와 oracle return으로 participant score `g_{i,t}` 정산
4. stake update + NAV alpha 기반 mint 분배

## 2. 제품 원칙
- no-legacy: 기존 crawl/evidence claim 모델을 유지하지 않는다.
- deterministic: 동일 epoch 입력이면 동일 집계/정산 결과를 재현해야 한다.
- sybil-resistance: 보상/민팅은 반드시 stake 가중을 포함한다.
- separation of concerns:
  - offchain(relayer/strategy): projection, scoring, oracle assembly
  - onchain(contracts): execution constraints, vault accounting, mint settlement

## 3. 범위 (In Scope)
### 3.1 Claim/Consensus
- AllocationClaimV1 제출/조회
- epoch별 aggregate/projection 결과 저장
- participant score 계산(`g_{i,t}`) 및 stake update

### 3.2 Execution
- projected target 기반 strategy intent 생성
- allowlist/slippage/notional 제약 검증 후 실행

### 3.3 Reward
- NAV alpha 기반 mint budget `M_t`
- stake-weighted mint allocation `\Delta N_{i,t}`

## 4. 범위 제외 (Out of Scope, v1)
- 레거시 claim attestation(검증자 서명 집계) 제거
- 레거시 snapshot hash 체계
- 외부 데이터 크롤링 품질 경쟁 모델

## 5. 시스템 요구사항
### 5.1 SDK
- AllocationClaimV1 canonical/hash
- epoch state hash/settlement serialization

### 5.2 Relayer
- allocation claims API
- epoch aggregation/settlement API
- settlement audit log 저장

### 5.3 Contracts
- intent의 epoch state 참조 필드
- vault reward mint 엔트리포인트

### 5.4 Agents
- participant: target weight claim 제출
- strategy: aggregate/projection 기반 intent 제안

## 6. 성공 지표
- 기능 지표
  - claim 제출 성공률
  - epoch 정산 완료율
  - intent 실행 성공률
- 경제 지표
  - stake update 재현성
  - mint 분배 합계와 `M_t` 일치율
- 운영 지표
  - 정산 지연 시간(epoch close -> settle)
  - 실패 재시도 후 복구율

## 7. 전환 전략
구현 순서와 상세 파일 계획은 `docs/CLAIM_REDESIGN_V1_kr.md`를 단일 기준으로 따른다.
