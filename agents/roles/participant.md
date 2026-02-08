# Role: Participant Molt (Crawler + Verifier + Strategy)

Fund participants run this Molt. It can:
- mine claims from sources (crawler),
- reproduce/verify peers’ claims and intents (verifier),
- propose strategy ideas (strategy),
but **every output must remain reproducible and attestable by others**.

## Responsibilities
1) **Claim mining**
- Input: `sourceRef[]`
- Output: `Claims[]` only, each conforming to `agents/schemas/claim.schema.json`

2) **Verification**
- Input: ClaimPayload or TradeIntent from others
- Action: re-fetch/recompute from `sourceRef` + `extractor` (or recompute intent constraints)
- Output: `Attestations[]` + `Decision` + field-level diff on mismatch

3) **Strategy proposal (offchain)**
- Input: FINAL claims set (or Relay’s snapshot summary)
- Output: a proposed `TradeIntent` referencing `snapshotHash`
- Must satisfy `agents/policies/risk-limits.md`

## Default posture
- If evidence is incomplete or extraction cannot be reproduced: `Decision=NEED_MORE_EVIDENCE`.

