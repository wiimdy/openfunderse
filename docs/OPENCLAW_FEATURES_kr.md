# OpenClaw (Claw Protocol) - Product-Level Feature Spec (KR)

## 0. 한 줄 요약
OpenClaw는 AI 에이전트가 근거 기반 Claim을 발행하고, 검증을 조율하며, 리스크 제약이 강제되는 Vault를 통해 온체인 Intent를 실행할 수 있게 하는 프로토콜 + 레퍼런스 앱입니다.

즉 "에이전틱 의사결정"을 "검증 가능하고, 거버넌스 가능하며, 실행 가능한" 워크플로우로 바꿉니다.

## 1. 제품 구성(Ship 형태)
OpenClaw는 아래 형태로 제공됩니다.
- **Protocol(컨트랙트)**: registries, claim/intent books, vaults, incentives, disputes
- **Reference relayer + agent SDK**: 표준 해시/서명, 배치 제출, 에이전트 스캐폴딩
- **App UI**: claim explorer, validator console, vault dashboard, strategy console
- **Indexing/API**: 이벤트 기반 인덱서 + 앱/에이전트가 쓰는 query API

## 2. 핵심 오브젝트(용어)
- **Agent**: submit/attest/execute를 수행하는 주소(EOA 또는 ERC-1271 스마트월렛)
- **Claim**: 추출된 데이터에 대한 커밋 + evidence 포인터
- **Evidence**: claim을 검증하기 위한 암호학적 증명 또는 재현 가능한 검증 방법
- **Dataset/Snapshot**: epoch 단위로 FINAL claim 집합을 고정하고 `snapshotHash`로 요약한 것
- **Intent**: snapshot에서 도출된 구조화된, 서명 가능한 액션 제안(예: trade)
- **Attestation**: verifier가 claim/intent에 대해 올리는 서명 기반 승인
- **Vault**: 자산을 보관하고 제약 조건 하에 실행하는 온체인 실행기
- **Validation Market**: 검증 작업에 대한 인센티브 + 스테이크 + 평판 + 분쟁(디스퓻)

## 3. 시스템 목표(제품 수준)
- **Trust-minimized execution**: 단일 운영자가 강제로 실행할 수 없고, 승인이 온체인에서 강제됨
- **Data provenance**: 입력이 근거 기반이며 감사 가능
- **Permissioned -> Permissionless 경로**: 안전을 위해 allowlist로 시작하고, sybil 저항 포함 오픈 마켓으로 확장
- **Composable**: 어떤 전략 에이전트든 플러그인 가능, 어떤 verifier 네트워크든 경쟁 가능
- **Monetizable**: 수수료/보상 + (옵션) 토큰 메커니즘
- **Production grade**: 관측, 키 관리, 실패 모드, 운영/인시던트 컨트롤

## 4. 기능 세트 (MVP -> v1 -> v2)
Legend:
- MVP: 해커톤용, end-to-end 동작
- v1: 실제 유저를 위한 베타(여전히 리스크 보수적으로)
- v2: 스케일/permissionless/더 강한 암호학적 보장

### 4.1 Agent 신원, 발견(Discovery), 권한
MVP
- crawler/verifier/strategist/relayer를 위한 단순 allowlist registry
- EOA + ERC-1271 signer 지원(스마트 계정)

v1
- Agent 프로필: capability, endpoint, pricing, contact를 담는 `agentURI`
- 도메인 바인딩: `/.well-known/...` 같은 방식으로 도메인 컨트롤 증명(옵션)
- Vault별 role 기반 권한(verifier set, thresholds)

v2
- ERC-8004 정렬(Identity/Reputation/Validation registries) 또는 어댑터 컨트랙트
- 멀티체인 identity linking(옵션)

### 4.2 Claim 스키마와 Evidence 타입
MVP
- 1-2개 안정적인 claim schema(데모 결정성)
- Evidence: "재크롤 합의"(N verifier가 재수집해 추출값을 매칭)
- Canonical claim hashing 스펙(에이전트/릴레이어/UI 간 불일치 방지)

v1
- 플러그인 가능한 schema registry: `schemaId -> validation rules`
- Evidence 타입:
- signed API receipts(프로바이더 서명 영수증)
- TEE attestation(예: SGX 기반 크롤)
- rate-limited mirrored datasets
- Claim 버저닝과 deprecation

v2
- 선택 소스에 zkTLS evidence(가장 강한 와우 포인트 + trust minimization)
- Proof aggregation(배치 검증)
- Provenance graph: claim -> 파생 지표 -> intent 연결

### 4.3 검증 시장(Verifiers)
MVP
- N-of-M threshold 승인 + signer 유니크 강제
- points 기반 보상 + 리더보드

v1
- verifier별 stake + 가중치(옵션):
- attest 최소 stake
- stake-weighted threshold
- Validator SLA:
- 응답 윈도우
- uptime 스코어
- 작업 마켓:
- claim/intent가 "validation job"을 열고 바운티 제공

v2
- Disputes + slashing:
- challenge window
- fraud proof / counter-evidence
- 명백히 거짓인 attestation에 대한 slashing
- Sybil 저항:
- stake + reputation + identity signals
- Delegation:
- 사용자가 신뢰 리스트/검증자 세트를 위임

### 4.4 Snapshots / Dataset Finality
MVP
- FINAL claim hashes로 epoch snapshot finalize
- 정렬된 claim hashes로 snapshot hash 결정적 계산

v1
- Vault별 snapshot 정책:
- 최소 소스 수
- freshness 제약(최대 나이)
- 카테고리별 quorum
- Dataset compaction:
- snapshot + Merkle root만 온체인 저장하고, 전체 리스트는 오프체인

v2
- snapshot에 claim 포함을 증명하는 Merkle proofs
- 고주파 신호를 위한 rolling snapshots

### 4.5 Strategy와 Intent 시스템
MVP
- 전략 에이전트가 `snapshotHash`를 참조하는 TradeIntent 출력
- Intent 승인 임계치를 온체인에서 강제

v1
- 전략 마켓플레이스:
- 버전된 전략 패키지
- 퍼포먼스 페이지
- Vault별 파라미터 설정
- Intent 시뮬레이션:
- quote 체크
- 실행 전 sanity 체크
- 다른 액션을 위한 intent 템플릿:
- liquidity provision
- governance votes
- token launches

v2
- Verifiable compute 옵션:
- 치명적인 부분은 deterministic strategy engine
- (선택적으로) 시뮬레이션 결과를 zk/TEE로 증명
- Multi-intent bundles(원자적 시퀀스)

### 4.6 Vault 및 실행(Safety First)
MVP
- 단일 자산 예치 Vault
- 승인된 intent만, allowlisted venue(s)에서만 실행
- 리스크 컨트롤: max trade size, slippage, deadlines, cooldown, pause

v1
- 멀티 자산 Vault 및 전략별 sub-vault
- 수수료 모델:
- management/performance fee(옵션)
- validation fee
- relayer fee
- 보험/세이프티 펀드(옵션)

v2
- MEV 보호 옵션:
- private tx relays(가능하면)
- RFQ / auction execution
- Circuit breakers:
- oracle guards
- 변동성 기반 halt
- rolling window loss limits

### 4.7 평판, 보상, 토크노믹스
MVP
- points만(miners, verifiers, strategists)

v1
- reputation 신호:
- acceptance rate
- dispute rate
- 응답 latency
- realized PnL impact(해석 주의)
- 보상:
- vault 수수료 일부를 verifiers/strategists에 분배
- validated claims에 대한 바운티

v2
- 토큰 메커니즘(옵션):
- verifier staking token
- reward token emission
- 파라미터 거버넌스
- Anti-gaming:
- decay
- sybil filters
- dispute 기반 페널티

### 4.8 Relayer 네트워크(집계)
MVP
- 레퍼런스 relayer 1개로 서명 배치
- permissionless submission(누구나 배치 제출 가능) + verifiers는 allowlist

v1
- 복수 relayer 경쟁:
- mempool watchers
- 배치 포함을 위한 fee market
- Anti-censorship:
- fallback submitters
- anyone-can-finalize 함수

v2
- 메트릭 + 평판 기반의 분산 relayer 셋

### 4.9 App / UX
MVP
- Claim explorer + attestation 진행률
- Intent 대시보드 + 승인 진행률
- Vault 잔고/실행 내역 + points 리더보드

v1
- Validator console:
- job 큐
- evidence 뷰어
- 원클릭 attest/sign
- Strategy console:
- 설정
- 백테스트 / 페이퍼 트레이드
- 알림:
- Discord/Telegram/webhooks

v2
- 커뮤니티 프리미티브:
- strategy "clubs"
- shared vaults
- social proof + 온체인 follow 그래프

### 4.10 개발자 경험(DX)
MVP
- 최소 SDK:
- canonical hashing
- EIP-712 서명 헬퍼
- claim/intent JSON schema validator
- 스크립트:
- deploy
- demo loop runner

v1
- Agent 스캐폴드:
- crawler 템플릿
- verifier 템플릿
- strategy 템플릿
- 로컬 시뮬레이터:
- forked chain + 결정적 AMM
- Indexer용 OpenAPI 스펙

v2
- 플러그인 시스템 + 전략 패키징 표준
- 검증 마켓플레이스 + evidence 가격 발견

### 4.11 보안, 운영, 거버넌스
MVP
- Pausable 컨트랙트
- signature/threshold/execution 기본 테스트

v1
- 업그레이드 정책:
- timelock
- multi-sig guardian
- 모니터링:
- tx 실패 알림
- vault invariant 체크
- relayer health + backlog
- 시크릿/키 관리:
- 필요 시 HSM 또는 secure enclave

v2
- 핵심 vault 제약의 formal verification
- bug bounty + audits
- 인시던트 런북 + 안전 드릴

## 5. "프로덕션 수준"의 비협상 조건
데모를 넘어 운영하려면 아래는 반드시 지켜야 합니다.
- **단일 주체가 트레이드를 실행할 수 없어야 함**(threshold signatures + 온체인 체크)
- **명시적 리스크 제한**(caps, slippage, deadlines, allowlists)
- **Replay 방지**(nonce + expiry)
- **안전한 실패 모드**(validator가 다운되면 아무 일도 일어나지 않음)
- **모니터링 + pause**(빠르게 멈출 수 있어야 함)

## 6. 추천 포지셔닝 (Hackathon -> Product)
- Hackathon: 단일 히어로 루프로 "Verified Data Swarm Vault"를 보여주기
- Product: 커뮤니티가 아래를 쉽게 스핀업하게 하는 "OpenClaw Protocol"
- data market(claims + validation)
- strategy market(intents + validation)
- capital pool(vault execution)

