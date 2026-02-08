# NadFun ChatOps Prompting Spec (v0)

본 문서는 OpenClaw 문서/이슈 기준으로, NadFun 펀드를 "텔레그램 채팅방 단위"로 운영하기 위한 프롬프트 아키텍처를 고정한다.

## 1. 방향성 확정 (기존 이슈/문서 기준)

기준 문서:
- `docs/ARCHITECTURE.md`
- `docs/PRD_kr.md`
- `docs/ARCHITECTURE_CHATOPS_kr.md` (origin/main)

기준 이슈:
- #2 Canonical hashing + EIP-712
- #4 ClaimBook v0
- #5 Snapshot v0
- #6 IntentBook v0
- #8 Relayer/Aggregator v0
- #9 Indexer/API v0
- #10~#13 Agent SDK + Crawler/Validator/Strategy

결정:
1. 역할은 3개로 분리한다.
- `Relayer (중앙 Next 서버)`: 데이터/서명 수집, 집계, 제출, 정산 상태 갱신
- `Strategy MoltBot`: 최종 스냅샷 기반 Intent 제안
- `Participant MoltBot`: 데이터 마이닝 + 교차 검증 + 정산 이전 Attestation

2. Strategy와 Relayer는 논리적으로 분리한다.
- 같은 인프라에 배포는 가능하지만 키/권한/책임은 분리
- Relayer는 집계자, Strategy는 제안자

3. 중앙 Next 서버 모델을 허용하되, 온체인 검증 강제는 유지한다.
- 오프체인 중앙화: 속도/개발 생산성 확보
- 온체인 무결성: threshold/중복방지/만료체크/서명검증 강제

## 2. NadFun 펀드 운영 목적 (v0)

운영 목적:
1. NadFun 생태계(본딩커브 -> 졸업 후 DEX)의 토큰 신호를 빠르게 수집
2. 단일 운영자 판단이 아닌 참여자 MoltBot들의 교차 검증으로 신뢰도 확보
3. 검증된 스냅샷을 근거로만 Intent를 제안/승인/실행

NadFun 컨텍스트:
- Network: testnet(10143) / mainnet(143)
- 주요 관측 대상: 본딩커브 상태, 거래/유동성/홀더/메타데이터 이벤트, 졸업 이벤트

## 3. 펀드 단위 운영 모델 (Telegram Room Multi-tenant)

펀드 식별자:
- `fundId`: 펀드 고유 ID
- `roomId`: 텔레그램 채팅방 ID
- `epochId`: 의사결정 사이클

격리 원칙:
1. 모든 Claim/Attestation/Intent는 `fundId` 스코프에 귀속
2. `roomId`는 명령/알림 채널이며 권한 정책과 연결
3. `snapshotHash`는 `(fundId, epochId, orderedClaimHashes)` 문맥에서 유일해야 함

## 4. 역할별 책임 경계

### 4.1 Relayer (중앙 Next 서버)
- API로 Observation/Attestation 수집
- 중복/만료/권한 검증
- threshold 충족 시 온체인 제출(`attestClaim`, `attestIntent`)
- 최종 정산/상태 집계 및 채팅 알림

절대 금지:
- 검증 없이 Intent 임의 승인
- fund 스코프 혼합

### 4.2 Strategy MoltBot
- 입력: finalized `snapshotHash` + indexer metrics + risk policy
- 출력: 제약 포함 TradeIntent(JSON)
- 실패 시 HOLD 결정과 사유 출력

절대 금지:
- 미확정 snapshot 기반 제안
- 리스크 룰 우회 제안

### 4.3 Participant MoltBot
- 마이닝: SourceSpec 기반 Observation 생성
- 검증: 동일 스펙 재현/교차검증 후 PASS/FAIL Attestation
- 정산 이전 서명 제출

절대 금지:
- 임의 키 공유/대리서명
- evidence 없는 PASS 판단

## 5. 프롬프트 세분화 (실사용 단위)

프롬프트 파일:
- `prompts/kr/base_system.md`
- `prompts/kr/relayer_next_server.md`
- `prompts/kr/strategy_moltbot.md`
- `prompts/kr/participant_moltbot.md`

운영 규칙:
1. 모든 역할 프롬프트 앞에 `base_system`을 prepend
2. 역할 프롬프트는 task 단위로 분기(마이닝/검증/집계/전략제안)
3. 출력은 JSON only
4. 파싱 실패 시 재생성(temperature 낮춤)

## 6. 최소 API 계약 (프롬프트 입력/출력 호환)

권장 API:
1. `POST /v1/funds/{fundId}/claims`
2. `POST /v1/funds/{fundId}/attestations`
3. `GET /v1/funds/{fundId}/snapshots/latest`
4. `POST /v1/funds/{fundId}/intents/propose`
5. `POST /v1/funds/{fundId}/intents/attestations/batch`
6. `GET /v1/funds/{fundId}/status`

필수 공통 필드:
- `fundId`, `epochId`, `roomId`, `sourceSpecId`(해당 시), `claimHash`/`snapshotHash`/`intentHash`

## 7. 이슈 우선순위와 프롬프트 적용 순서

1. #2 해시/서명 스펙 고정
2. #4, #5, #6 컨트랙트 인터페이스 고정
3. #8, #9로 오프체인 집계/API 골격 구현
4. #10~#13 에이전트 프롬프트/SDK 연결
5. #14 E2E 러너에서 펀드 룸 1개 시나리오 검증

## 8. 의사결정 메모 (현재 쟁점 반영)

질문: Strategy를 Relayer로 한정할지?
- 결론: 기본은 분리. v0에서는 Strategy allowlist로 제어.

질문: 완전 탈중앙 vs 중앙 Next 허브?
- 결론: v0는 중앙 Next 허브 허용 + 온체인 검증 강제.
- 이유: 구현속도/가스/운영 단순화와 보안 최소조건의 균형.
