# ChatOps Swarm Fund 보완/보안 체크리스트 (KR)

이 문서는 `docs/ARCHITECTURE_CHATOPS_kr.md` 아키텍처를 "데모 수준"에서 "실제품 수준"으로 끌어올릴 때 반드시 점검해야 할 항목을 체크리스트로 정리합니다.

표기:
- `[P0]` 출시/데모 전에 반드시 막아야 하는 리스크
- `[P1] 공개 베타 전에 필요한 보완
- `[P2] 운영 안정성/확장성 개선(있으면 강함)

---

## A. 신뢰 경계/위협 모델
- [ ] [P0] "무엇을 신뢰하는지"를 문서로 고정했다(온체인 룰 + 서명만 신뢰).
- [ ] [P0] "무엇을 신뢰하지 않는지"를 명시했다(LLM 텍스트, 단일 크롤러, 단일 릴레이어).
- [ ] [P0] 실패 모드가 안전하다(검증이 안 모이면 실행이 안 됨).
- [ ] [P1] 공격 시나리오 10개 이상을 작성했다(시빌, 담합, 데이터 오염, MEV, 키 유출, SSRF 등).

## B. 신원/시빌/담합 저항(Verifier 네트워크)
- [ ] [P0] MVP에서 verifier는 allowlist로 시작한다(= permissionless verifier 금지).
- [ ] [P0] 1인 다계정(시빌) 방지 정책이 있다(운영자 단위 allowlist 또는 stake gate).
- [ ] [P1] stake 기반 참여 조건(최소 stake) 또는 가중치(스테이크/평판)를 로드맵/스펙으로 확정했다.
- [ ] [P1] 담합 탐지 지표를 정의했다(동시성, 상관관계, 동일 IP/도메인, 동일 운영자, 동일 패턴).
- [ ] [P2] dispute/slash 경로를 정의했다(챌린지 윈도우, 증거 제출, 명백한 거짓 attestation 페널티).

## C. 데이터 재현성(웹/오프체인 데이터의 함정)
- [ ] [P0] SourceSpec에 fetch 조건을 포함한다(UA, locale, viewport, 렌더 방식, cache 정책).
- [ ] [P0] SourceSpec에 freshness 규칙이 있다(예: 10분 이내 관측만 유효).
- [ ] [P0] Observation에 `responseHash`와 `evidenceURI`를 필수로 둔다.
- [ ] [P0] selector가 깨질 때의 대응이 있다(SourceSpec 버전업/폐기/롤백).
- [ ] [P1] 동적 페이지(AB 테스트/지리/로그인/봇차단)에서의 표준 증거 포맷을 정의했다(원문 스냅샷/영수증/스크린샷/헤더 등).
- [ ] [P2] zkTLS/TEE 증거 타입을 최소 1개 소스에 붙이는 경로를 확보했다(“재크롤 합의”만의 한계 보완).

## D. SourceSpec/URL 입력 보안(SSRF/악성 컨텐츠)
- [ ] [P0] 크롤러는 임의 URL을 그대로 방문하지 않는다(도메인 allowlist 또는 강한 필터).
- [ ] [P0] 크롤러 런타임은 샌드박스다(컨테이너/권한 최소화/outbound 제한).
- [ ] [P0] 크롤링/파싱은 타임아웃/메모리/파일 시스템 제한을 둔다(DoS 방지).
- [ ] [P1] 악성 HTML/JS 대응 정책이 있다(스크립트 실행 금지 또는 엄격한 headless 정책).
- [ ] [P1] Evidence Store(URI) 접근 정책이 있다(서명된 URL, 만료, 접근제어, 민감정보 차단).

## E. ChatOps 조작/프롬프트 인젝션
- [ ] [P0] Strategy 입력은 "finalized snapshot + 온체인 인덱서 지표"만 허용한다(채팅 원문은 직접 입력 금지).
- [ ] [P0] Scout(관심 탐지) 출력은 "후보"이며 실행 권한이 없다(명시적으로 분리).
- [ ] [P1] 채팅 커맨드 권한을 설계했다(관리자 전용 커맨드, 읽기 전용 커맨드).
- [ ] [P1] 봇이 채팅에서 받은 링크/텍스트를 즉시 실행(크롤)하지 않는다(승인/검증 단계 필요).

## F. 해시/서명/리플레이 방지(프로토콜 정합성)
- [ ] [P0] claimHash/intentHash canonical encoding을 문서+테스트 벡터로 고정했다.
- [ ] [P0] 모든 서명은 EIP-712 typed data를 사용한다.
- [ ] [P0] 서명 payload에 `nonce` + `expiry`가 포함된다(리플레이 방지).
- [ ] [P0] 동일 subject에 대해 verifier 1회만 인정한다(uniqueness 강제).
- [ ] [P1] ERC-1271(스마트계정) 서명도 지원한다(운영/세션키에 유리).

## G. Relayer(집계자) 중앙화/검열/라이브니스
- [ ] [P0] relayer는 “집계/제출”만 하고 단독 실행 권한이 없다(threshold 필수).
- [ ] [P0] 누구나 배치 제출할 수 있다(permissionless submission) 또는 최소 2개 relayer 운영.
- [ ] [P1] relayer 제출은 idempotent다(중복 제출/재시도 안전).
- [ ] [P1] 검열/지연 시 대체 경로가 있다(다른 relayer, 누구나 finalize 가능 함수).
- [ ] [P2] relayer 평판/메트릭을 만든다(성공률, 지연, 실패율, 제출 비용).

## H. Strategy(최종 결정) 안전장치
- [ ] [P0] Strategy는 구조화 Intent만 출력한다(자유 텍스트가 아닌 JSON/struct).
- [ ] [P0] Intent는 snapshotHash/datasetHash를 참조한다(근거 없는 실행 금지).
- [ ] [P1] Intent 생성 전에 기본 sanity check를 한다(유동성/슬리피지/가격 급변).
- [ ] [P2] 실행 전 quote check 또는 시뮬레이션(가능하면) 단계가 있다.

## I. Vault 실행(마지막 방어선)
- [ ] [P0] 토큰/venue allowlist를 강제한다.
- [ ] [P0] slippage(minOut) + deadline을 강제한다.
- [ ] [P0] max trade size(또는 pctOfVault) cap을 강제한다.
- [ ] [P0] cooldown을 강제한다(연속 매매/폭주 방지).
- [ ] [P0] emergency pause + 안전한 출금 경로가 있다.
- [ ] [P1] loss limit/circuit breaker를 정의한다(변동성/손실 기반 halt).
- [ ] [P1] MEV 완화 전략이 있다(작은 사이즈, tight slippage, 필요 시 private tx).

## J. 거버넌스/멀티시그/업그레이드
- [ ] [P0] 멀티시그가 upgrade/pause/핵심 파라미터를 통제한다.
- [ ] [P0] 거버넌스로 변경 가능한 파라미터와 불가능한 파라미터를 구분했다.
- [ ] [P1] timelock 정책이 있다(중요 파라미터 변경은 지연 후 실행).
- [ ] [P1] 키 회전/권한 변경 런북이 있다.

## K. CrawHub/Skill 공급망(오프체인 허브 보안)
- [ ] [P0] Skill 패키지 무결성 정책이 있다(해시 고정, 서명, 버전 고정).
- [ ] [P0] Job Queue는 인증/권한이 있다(아무나 작업 폭탄 투하 금지).
- [ ] [P1] 크롤러/검증자 작업은 rate limit/backpressure가 있다.
- [ ] [P1] Evidence Store는 민감정보(쿠키/토큰/개인정보) 저장을 금지/필터한다.

## L. 관측/모니터링/운영(Production)
- [ ] [P0] 핵심 이벤트/지표를 모니터링한다(실행 tx 실패, pending intent, 검증 지연, vault 잔고).
- [ ] [P0] 알림 채널과 담당(온콜)이 정해져 있다.
- [ ] [P1] 인시던트 대응 런북이 있다(멈추기/복구/키 회전/공지).
- [ ] [P2] 주기적인 안전 리허설(“pause drill”)을 한다.

## M. 테스트(필수)
- [ ] [P0] 서명 검증/threshold/uniqueness에 대한 유닛 테스트가 있다.
- [ ] [P0] claimHash/intentHash 테스트 벡터가 3개 이상 있고, 언어 간 일치한다.
- [ ] [P1] agent->relayer->onchain->indexer->chat UI까지 E2E 데모 스크립트가 있다.
- [ ] [P2] 퍼징/인버리언트 테스트로 "승인 없이 실행 불가"를 증명한다.

## N. 제품/커뮤니티 신뢰(비기술)
- [ ] [P0] 투자 조언 아님/리스크 고지가 있다.
- [ ] [P1] 사용자에게 "왜 실행됐는지"를 설명하는 UX가 있다(snapshot/evidence/서명자 목록).

