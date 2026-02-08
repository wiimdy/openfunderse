# OpenClaw 로드맵 (KR)

이 로드맵은 "해커톤급 데모를 빠르게 출시"한 뒤, 실제 제품으로 진화시키는 흐름을 가정합니다.

## Phase 0: 해커톤 데모 (2주)
목표: "히어로 루프"를 끝까지, 결정적으로(데모가 안 깨지게) 배송합니다.

Ship
- Claim schema V1(2-3개 소스, 안정적인 것)
- ClaimBook + IntentBook + Vault(리스크 컨트롤 + pause)
- Threshold verifier attestations(allowlist verifiers)
- 레퍼런스 relayer(서명 배치)
- 단순 전략 에이전트(rule-based여도 OK)로 TradeIntent 생성
- UI 대시보드 + 리더보드
- 데모 AMM(권장): 실행이 매번 동일하게 나오도록

Defer
- slashing/disputes
- zkTLS(신뢰성 확보 가능하면 옵션)
- permissionless verifiers

## Phase 1: Beta (3-6주)
목표: 실제 유저가 써볼 수 있게 하되, 리스크는 타이트하게 통제합니다.

Ship
- ERC-1271 지원(verifier/strategy가 스마트월렛이어도 서명 가능)
- Multi-relayer 지원(누구나 배치 제출 가능)
- Indexer + Query API
- 전략 설정 UI
- Snapshot 정책(freshness, 최소 소스 수)
- 기본 수수료 모델(vault 실행 fee + validator fee)

Hardening
- 통합 테스트(agent -> relayer -> contracts -> UI)
- 모니터링/알림
- 업그레이드 정책(timelock + multisig)

## Phase 2: Mainnet-Ready (2-4개월)
목표: 더 trust-minimized하게, 적대적 환경에서도 버티도록 만듭니다.

Ship
- stake 기반 verifier 게이팅(min stake)
- Claim/Intent에 challenge window
- 보수적으로 시작하는 slashing(명백히 나쁜 attestation에 한정)
- reputation 메트릭과 가중치
- 더 안전한 실행 경로(RFQ, 가능하면 private tx)

Security
- vault + signature 로직 외부 오딧
- 버그바운티

## Phase 3: 프로토콜 확장 (4-9개월)
목표: 트레이딩뿐 아니라 "검증된 인텐트 실행" 전반을 지원하는 프로토콜로 확장합니다.

Ship
- 더 많은 intent 타입:
- liquidity provision
- governance actions
- token launch automation(nad.fun 연동)
- 선택 소스에 zkTLS evidence
- Merkleized snapshots(온체인 저장을 컴팩트하게)
- Strategy marketplace + packaging

Decentralization
- permissionless verifier market(stake + sybil controls)
- 파라미터 거버넌스(옵션: 토큰/DAO)

