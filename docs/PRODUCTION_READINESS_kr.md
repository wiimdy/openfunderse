# 프로덕션 준비도 체크리스트 (OpenClaw) (KR)

정말로 "실제품 수준"으로 운영하려면, 해커톤 데모를 넘어 아래를 충족해야 합니다.

## 1. 프로토콜 정합성
- claim/intent hashing에 대한 canonical encoding 스펙(문서화 + 테스트).
- 모든 서명은 EIP-712 typed data로, 아래를 포함:
- chainId 바인딩
- 컨트랙트 바인딩
- nonce
- expiry
- snapshot 결정성: 정렬 규칙을 엄격히 정의하고 언어 간 테스트.
- 이벤트 설계: 인덱싱 시 모호함이 없도록(필드 의미/버전/해시 포함).

## 2. Vault 안전장치
- 토큰/venue allowlist(처음엔 타이트하게).
- 아래를 온체인에서 강제:
- max trade size
- slippage caps(minOut)
- deadlines
- trades 간 cooldown
- 일일/rolling loss limits(실자금이면 추천)
- emergency pause + 안전한 출금 경로.
- reentrancy 가드 + safe ERC20 transfer.

## 3. 적대적 환경에서의 견고함
- Sybil 방어 계획:
- allowlist -> stake gate -> reputation weighting -> disputes/slashing
- 검열 저항:
- permissionless batch submission
- anyone-can-finalize 함수
- 분쟁 해결:
- challenge windows
- evidence 제출 규칙
- 보수적 slashing

## 4. 오프체인 신뢰성(Agents + Relayers)
- relayer 제출의 idempotency(재시도 안전).
- validation job 큐잉 + 백프레셔.
- 키 관리:
- 역할별 키 분리
- 가능하면 하드웨어 기반 서명
- 크롤러 rate limit + 샌드박싱(차단/플레이키 데이터 방지).

## 5. 관측 가능성/운영
- 모니터링:
- vault invariants
- pending intents 및 만료
- relayer backlog
- failed txs
- 알림:
- on-call 채널과 severity 레벨
- 런북:
- pause 절차
- 인시던트 대응 단계
- 키 로테이션

## 6. 보안 프로세스
- 릴리즈마다 내부 위협 모델 점검.
- 외부 오딧 대상:
- signature verification 로직
- vault 실행 경로
- 업그레이드 컨트롤
- mainnet-facing이면 버그바운티.

## 7. UX와 신뢰
- UI에서 아래를 명확히 보여주기:
- 왜 실행됐는지(snapshot + evidence 링크)
- 누가 승인했는지(verifier set)
- 어떤 제약이 적용됐는지(caps, slippage)
- 고지사항:
- financial advice 아님
- 리스크 경고
- beta 상태

## 8. 컴플라이언스/리스크(비기술)
- 타겟 유저(리테일 vs 숙련자)와 관할권 결정.
- 특정 플로우에 KYC가 필요한지 결정.
- 법률 자문 없이 "투자상품"처럼 보이게 만드는 표현/구조는 회피.

