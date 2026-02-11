# Claw: Verified Data Swarm Vault (Monad) - PRD (KR)

## 1. 요약
Claw는 온체인 Vault로, 독립적인 에이전트(Verifier) 무리가 다음을 Attestation(서명)으로 확인했을 때만 트레이드를 실행합니다.
1) 특정 소스에서 채굴한 데이터 Claim(근거 포함)의 유효성
2) 그 검증된 Claim들로부터 도출된 Trade Intent(거래 의도)의 안전성/일관성

이 제품은 에이전트-에이전트 조율을 온체인 강제 실행과 자동 보상으로 연결해 "규모 있게 트랜잭션하는 에이전트"를 보여줍니다.

## 2. 문제
에이전트 기반 트레이딩 프로토타입은 보통 신뢰(Trust)에서 무너집니다.
- 데이터 입력이 검증 불가능함 (프롬프트 인젝션 / 유리한 근거만 선택).
- 단일 운영자가 실행을 통제함 (중앙화 릴레이어 리스크).
- 책임소재가 불투명함 (누가 무엇을 주장했고, 누가 보상/슬래시를 받는지).

우리는 아래를 만족하는 구조가 필요합니다.
- 데이터 출처/변환이 감사 가능(auditable)해야 함.
- 의사결정이 다자 검증(multi-party validation)으로 게이팅되어야 함.
- 실행은 온체인이면서, 리스크 룰로 제약되어야 함.
- 올바른 기여는 보상하고(필요 시) 나쁜 기여는 페널티를 줄 수 있어야 함.

## 3. 목표 (해커톤 MVP)
- 근거 기반 데이터 Claim: 온체인에는 커밋(해시)만 저장하고, 무거운 근거는 오프체인으로.
- 멀티 에이전트 검증: 온체인 snapshot 기반 weighted threshold로 attestation 집계.
- Prompt-to-Intent 파이프라인: 검증된 데이터셋 스냅샷 -> 전략 출력 -> 구조화된 Trade Intent.
- 온체인 실행: Intent Attestation 임계치가 만족될 때만 Vault가 실행.
- 투명한 인센티브: Miner/Verifier 포인트/보상 및 명확한 리더보드.
- "weird + works" 데모: 전체 루프를 2분 내로 끝까지 보여주기.

## 4. 목표 제외 (MVP)
- 실자금 펀드 운영(데모/테스트 자금으로 취급; financial advice 아님).
- 모든 소스에 대한 완전한 trustless 웹 증명(zkTLS는 옵션).
- 복잡한 포트폴리오 운영, 레버리지, 크로스체인, 초고빈도 전략.
- 완전 일반화된 ERC-8004 준수(우선은 "ERC-8004-inspired"로 두고 이후 매핑).

## 5. 사용자 / 페르소나
- LP(예치자): Vault에 예치, 투명성과 안전을 원함.
- Data Miner(크롤러 에이전트 운영자): 크롤러를 돌려 Claim 제출, 보상 획득.
- Verifier(검증 에이전트 운영자): Claim/Intent 검증, (옵션) 스테이크, 보상 획득.
- Strategist(전략 에이전트): 검증된 스냅샷 기반으로 Trade Intent 제안.
- Operator(릴레이어): 서명 집계와 Intent/Attestation의 온체인 게시(복수 가능).

## 6. 핵심 개념: Claim -> Attest -> Snapshot -> Intent -> Attest -> Execute
정의:
- Claim: "소스 S에서, 시간 T에, selector X가 값 V를 반환한다" + 근거 포인터(evidence pointer).
- Claim 검증: Verifier들이 재크롤/증명 확인 후 `claimHash`에 Attest.
- Snapshot: 한 epoch의 FINAL `claimHash` 집합을 결정적으로 구성하고 `snapshotHash`로 요약.
- Trade Intent: `snapshotHash`를 참조하는 구조화 주문(tokenIn/out, amount, minOut, deadline, constraints).
- Intent 검증: Verifier들이 `intentHash`에 서명; 임계치 만족 시 Vault 실행 가능.

## 7. 제품 플로우 (MVP)
### 7.1 Epoch 루프
1) Crawler 에이전트가 ClaimPayload를 오프체인 저장소에 업로드하고, 온체인 `submitClaim(claimHash, claimURI, meta)`를 호출합니다.
2) Verifier 에이전트들이 Claim을 평가합니다.
   - Option A (MVP): 재크롤 후 추출값 비교, 일치하면 서명.
   - Option B (옵션): zkTLS proof 검증, 유효하면 서명.
3) Relayer가 Verifier 서명을 모아 `attestClaim(claimHash, sigs)`를 호출합니다.
4) Claim Attestation 임계치를 만족하면 Claim은 "FINAL"이 됩니다.
5) epoch 종료 시 스냅샷 생성: `finalizeSnapshot(epochId, claimHashes[])` -> snapshotHash.
6) Strategy 에이전트가 snapshot을 읽어 TradeIntent(구조화 JSON)를 생성하고, 온체인 `proposeIntent(intentHash, intentURI, snapshotHash, constraints)`로 게시합니다.
7) Verifier들이 Intent(리스크 체크 + 일관성)를 평가하고 `intentHash`에 서명합니다.
8) Relayer가 `attestIntent(intentHash, sigs)`를 호출합니다.
9) Vault는 Intent가 승인되었고 온체인 리스크 한도 내일 때만 `executeIntent(intent)`를 실행합니다.

### 7.2 UI / 데모
- 아래를 보여줍니다.
  - claim 목록(소스, 값, 시간)과 attestation 진행률
  - snapshot 생성
  - 제안된 intent(사람이 읽을 수 있는 형태)와 승인 진행률
  - 실행된 트레이드 tx hash + vault 잔고
  - miner/verifier 리더보드

## 8. 기능 요구사항
### 8.1 Claims
- Claim 커밋 제출 지원:
  - inputs: `claimHash`, `claimURI`, `sourceType`, `sourceRef`, `timestamp`, `schemaId`
  - store: 최소 메타데이터 + 상태 + attestation count
- 복수 Claim schema 지원(MVP는 1-2개 탑재).

### 8.2 Attestations (Claims + Intents)
- 등록된 에이전트만 attest 가능(MVP: allowlist 또는 단순 registry).
- 유니크 강제: claim/intent당 에이전트 1회 attestation.
- 임계치 정책:
  - claimThreshold: 예) 3 verifiers
  - intentThreshold: 예) 5 verifiers
  - (옵션) stake/reputation 가중치

### 8.3 Snapshots
- 정렬된 claimHashes + epochId로 snapshotHash를 결정적으로 계산.
- finalize 이후 snapshot을 freeze.

### 8.4 Intents
- TradeIntent 필드:
  - `action` (BUY/SELL)
  - `tokenIn`, `tokenOut`
  - `amountIn` 또는 `pctOfVault`
  - `minAmountOut`
  - `deadline`
  - `snapshotHash`
  - `maxSlippageBps`
  - `reasonHash` (전략 설명의 해시; 전체 텍스트는 intentURI에)

### 8.5 Vault 실행
- LP 예치/인출(MVP: USDC mock 같은 단일 자산).
- 아래 조건을 모두 만족할 때만 execute:
  - intent 승인됨
  - deadline 미만료
  - token/router allowlist 통과
  - 트레이드 크기 cap 내
  - minOut 강제
  - cooldown 및 일일 제한 OK
- 인덱싱/데모를 위해 이벤트를 명확히 emit.

### 8.6 보상 / 포인트 (MVP)
- 포인트 원장:
  - miners: 제출한 claim이 FINAL이 되면 포인트 획득
  - verifiers: "FINAL claim/intent에 대한 attestation"을 올바른 것으로 간주하고 포인트 부여(MVP 기준)
- (옵션) 소량 토큰 발행/수수료 분배도 가능하지만, MVP는 포인트+리더보드로 충분.

## 9. 비기능 요구사항
- Security:
  - 단일 relayer가 트레이드를 강제할 수 없음(threshold signatures 필수)
  - pausable contracts(guardian)
  - reentrancy 방지, 안전한 ERC20 전송
  - MVP에서는 토큰/라우터 allowlist를 엄격히
- Transparency:
  - 모든 claim/intent는 해시와 URI를 갖고, 모든 승인은 온체인에 기록
- Performance:
  - 온체인에 큰 blob을 저장하지 않음(해시+URI)
- Reliability:
  - 검증 라이브니스가 실패하면 vault는 아무것도 하지 않음(안전한 실패)

## 10. MVP 범위 (추천)
- 체인: Monad testnet/devnet 단일.
- 기준 자산: mock USDC(또는 체인 네이티브 스테이블).
- 타겟 밈코인: 데모 토큰 또는 알려진 testnet 자산.
- 거래 venue:
  - Option A: 데모 안정성을 위해 우리가 직접 배포한 minimal AMM.
  - Option B: 가용/안정하면 DEX router 통합.
- Claim schema:
  - 2-3개 소스에서 계산한 "소셜 모멘텀 점수"(예: 웹 카운터).
  - 데모 flaky를 피하려고 소스는 단순/안정적으로.
- 검증:
  - MVP는 verifier 재크롤 합의.
  - zkTLS는 "optional enhancement".

## 11. 리스크 및 완화
- Sybil verifiers:
  - MVP: allowlist; 이후: stake + reputation weighting + identity proofs.
- 데이터 오염/선택적 보고:
  - 독립 verifier 다수 + 공개 evidence URI 요구
  - 점수당 복수 소스 사용
- MEV / sandwich:
  - minOut + 타이트한 슬리피지 + 작은 사이즈; 이후 private tx 고려
- Relayer 검열:
  - 누구나 서명 집계를 제출할 수 있게(permissionless)
- 전략 실수:
  - 전략을 단순화; 온체인 리스크 cap; intentThreshold를 더 높임

## 12. 마일스톤 (2주)
- Day 1-2: schema/threshold 확정, 컨트랙트 스캐폴딩, 로컬 e2e 해피패스.
- Day 3-5: relayer 집계 + 서명 수집, 인덱서 스크립트.
- Day 6-8: crawler/verifier 에이전트, claim 생성 및 attestation 플로우.
- Day 9-11: UI 대시보드 + 리더보드, 데모 스크립트.
- Day 12-14: 폴리시, 테스트, 배포, 비디오, 제출 문서.

## 13. 오픈 질문
- "Agent" vs "Agent+Token" 트랙 중 무엇으로 제출할까?
- 크롤링 소스는 무엇이 충분히 안정적인가?
- MVP에 stake/slashing을 넣을까, points-only로 갈까?
