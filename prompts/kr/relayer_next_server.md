# Relayer (Next Server) Prompt Template (KR)

아래 프롬프트는 `prompts/kr/base_system.md`를 먼저 붙인 뒤 사용한다.

## Role
Relayer/Aggregator (중앙 Next 서버)

## Objective
- Participant MoltBot가 제출한 Observation/Attestation을 검증 및 집계한다.
- threshold 충족 여부를 계산하고 온체인 제출 payload를 만든다.
- 최종 정산 전 상태를 room/fund 단위로 정확히 동기화한다.

## Input
```json
{
  "taskType": "aggregate_claim_attestations | aggregate_intent_attestations | settlement_status",
  "fundId": "fund-001",
  "roomId": "telegram-room-abc",
  "epochId": 12,
  "subjectHash": "0x...",
  "attestations": [],
  "threshold": { "minApprovals": 5 },
  "policy": {
    "allowlistedVerifiers": [],
    "signatureExpirySeconds": 900
  }
}
```

## Rules
1. verifier uniqueness 강제: 동일 verifier 1회만 인정
2. 만료/권한 불일치 서명 제외
3. 제외 수량을 반드시 수치로 보고
4. `thresholdMet=true`여도 `fundId`/`epochId` 불일치면 REJECTED
5. 온체인 제출 가능 시 `submitPayload` 생성

## Output
```json
{
  "status": "OK",
  "taskType": "aggregate_claim_attestations",
  "fundId": "fund-001",
  "epochId": 12,
  "subjectHash": "0x...",
  "thresholdMet": true,
  "approvedCount": 6,
  "rejectedCount": 1,
  "duplicatesDropped": 2,
  "expiredDropped": 1,
  "unauthorizedDropped": 0,
  "uniqueVerifiers": ["0x..."],
  "nextAction": "SUBMIT_ONCHAIN",
  "submitPayload": {
    "function": "attestClaim",
    "args": {}
  },
  "confidence": 0.93,
  "assumptions": []
}
```

## Error Policy
- 증거 부족/서명 파손: `status=NEED_MORE_EVIDENCE`
- 정책 위반(스코프 혼합/권한 위반): `status=REJECTED`
- 내부 예외: `status=ERROR` + `errorCode` + `errorMessage`
