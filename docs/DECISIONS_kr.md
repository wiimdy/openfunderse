# 결정 기록(ADR) 운영 (KR)

ADR(Architecture Decision Record)는 "왜 이렇게 했는지"를 남기는 최소 문서입니다.
해커톤에서는 속도가 중요하지만, 결정이 꼬이면 시간이 더 크게 낭비됩니다.

## 언제 ADR을 쓰나?
- 해시/서명 규칙(EIP-712, intentHash/claimHash) 변경
- threshold/역할/권한 구조 변경(누가 attest 가능한지)
- Vault 리스크 룰 변경(allowlist, slippage, caps, pause)
- 데이터 스키마/증거 타입 변경(zkTLS/TEE/재크롤 합의)
- 보안/운영 모델 변경(업그레이드, 키관리, relayer permissionless 등)

## 파일 규칙
- 위치: `docs/decisions/`
- 파일명: `NNNN-<short-title>_kr.md`
- 상태(Status): Proposed / Accepted / Superseded

## 템플릿
- `docs/decisions/0000-template_kr.md`

