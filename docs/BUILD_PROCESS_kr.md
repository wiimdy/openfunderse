# Build Process (Hackathon-Oriented) (KR)

아이디어 -> 동작 데모 -> 제출까지, 해커톤 환경에서 실제로 굴러가는 결과물을 만들기 위한 실전 프로세스입니다.

## 1. MVP 확정 (1-2시간)
- 반드시 데모에서 보여줄 단 하나의 "히어로 루프"를 고정합니다.
- 예: `Claim -> Attest -> Snapshot -> Intent -> Attest -> Execute`
- 스코프를 작게 잠급니다.
- 예: 1개 Vault 자산, 1-2개 거래 토큰, 1개 venue(가능하면 데모 AMM), 1개 claim schema
- 아래를 숫자로 확정합니다.
- `claimThreshold`, `intentThreshold`
- 리스크 제한: `maxTrade`, slippage cap, cooldown
- 데모 성공 조건: 예) "claim 3개 -> trade 1회 실행"

산출물:
- 1페이지 스펙(PRD 요약으로 대체 가능)

## 2. 프로토콜 스펙 (반나절)
코딩 전에 "정확히 어떤 바이트를 서명하고 검증하는지"를 먼저 고정합니다.
- `claimHash`, `intentHash`의 canonical hashing 규칙
- EIP-712 domain separator
- nonce/expiry 규칙
- snapshot hashing 규칙(정렬/순서!)

산출물:
- 짧은 spec 문서(ARCHITECTURE에 포함해도 OK)

## 3. 위협 모델 (2-4시간)
풀 오딧까지는 아니더라도, 명백한 사고는 피해야 합니다.
질문:
- 악성 relayer가 무엇을 할 수 있나?
- 악성 verifier가 무엇을 할 수 있나?
- 전략 에이전트가 틀리면 어떻게 되나?
- 시스템은 어떻게 안전하게 실패(fail safely)하나?

산출물:
- 위협 체크리스트 + 완화책(pause, allowlist, threshold, caps, expiry)

## 4. 컨트랙트 우선 (2-3일)
구현 순서:
1) `ClaimBook`: submitClaim + attestClaim + finalized 상태 + snapshot hashing
2) `IntentBook`: proposeIntent + attestIntent + approved 상태
3) `ClawVault`: 리스크 체크 포함 executeIntent + 토큰/venue 연동
4) (옵션) points/reputation

테스트:
- 유닛 테스트:
  - 서명 검증
  - threshold 카운팅 및 유니크 강제
  - snapshotHash 결정성
  - vault 리스크 룰(minOut, deadline, allowlist)
- 인버리언트 테스트(있으면 좋음):
  - "승인 없이 실행 불가"
  - "cap 초과 불가"

산출물:
- 배포된 컨트랙트 + 로컬에서 전체 루프를 실행하는 스크립트

## 5. Participant Molt + Relay Molt (2-4일)
오프체인 컴포넌트는 최대한 단순하게 구현합니다.
- Participant Molt(Claim 마이닝):
  - fetch -> extract -> claim JSON 작성 -> claimHash 제출
- Participant Molt(검증):
  - claimURI 읽기 -> 재크롤 -> 일치하면 claimHash 서명
  - intentURI 읽기 -> 제약 조건 체크 -> intentHash 서명
- Relay Molt(집계기; POC 서비스):
  - 몇 개 참여자 서명 수집 후 배치 tx 제출
  - snapshot finalize + snapshotHash 참조 intent 생성/게시

MVP 핵심 선택:
- verifier 키 3-5개를 팀이 컨트롤하는 형태로 먼저 끝까지 돌립니다(아직 permissionless가 아님).

산출물:
- `make demo` 같은 단일 커맨드로:
  - claim 3개 게시
  - attestation 수집
  - snapshot finalize
  - intent propose
  - intent attestation 수집
  - trade execute

## 6. UI + 인덱싱 (2-3일)
복잡한 UI를 만들지 말고 "증명 대시보드"를 만듭니다.
- Claims 테이블(status, attestation count)
- Intents 테이블(승인 여부)
- Vault 잔고와 마지막 실행
- 리더보드(points)

인덱싱 옵션:
- 빠르게: 이벤트를 스크립트로 파싱해서 JSON으로 제공
- 더 나은 방식: 작은 indexer + SQLite

산출물:
- 데모에서 절대 안 깨지는 안정적인 UI

## 7. 데모 & 제출 패키지 (1-2일)
해커톤 성패는 "명확함"에 걸립니다.
- 2분 데모 스크립트:
  - claim 근거 -> 승인 진행 -> 실행 tx -> 잔고 변화
- README:
  - 문제, 접근, 아키텍처 다이어그램, 실행 방법
- 필요하다면 짧은 영상

산출물:
- 심사위원이 "play"만 누르면 흐름이 보이는 경험

## 8. 시간 남으면 추가할 것
1-2개만 고르세요.
- 1개 소스에 zkTLS evidence 붙이기(와우 포인트)
- stake + slashing(간단한 dispute window라도)
- reputation 기반 가중 threshold
- relayer 다중화(permissionless submissions)
- 실행 전 intent 시뮬레이션(quote check)
- private execution / MEV 완화
- nad.fun 토큰 런치 + points -> 토큰 전환

## 9. 자주 빠지는 것(실제로 터지는 포인트)
- canonical encoding 불일치(컴포넌트마다 hash가 다르게 계산됨)
- nonce 관리/서명 재사용(replay)
- snapshot의 claimHashes ordering
- slippage/minOut 미강제
- pause 경로 및 비상 복구
- 결정적 데모 venue(DEX 통합이 데모를 자주 망침)
