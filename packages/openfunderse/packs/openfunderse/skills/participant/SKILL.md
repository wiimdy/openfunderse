---
name: participant-skill
description: Participant MoltBot for data mining (claims) and cross-verification (attestations)
metadata:
  openclaw:
    requires:
      env:
        - RELAYER_URL
        - PARTICIPANT_PRIVATE_KEY
        - BOT_ID
        - BOT_API_KEY
        - CHAIN_ID
        - CLAIM_ATTESTATION_VERIFIER_ADDRESS
      bins:
        - node
        - npm
    primaryEnv: RELAYER_URL
    skillKey: participant
---

# Participant MoltBot Skill

The Participant MoltBot is responsible for mining data claims from specified sources and verifying claims or intents proposed by other agents. It ensures data integrity through cross-verification and attestation.

## Credential Scope

- `PARTICIPANT_PRIVATE_KEY` (or runtime fallback key) is used only for claim-attestation signing.
- Do NOT use treasury/custody/admin keys.
- Use a dedicated verifier/participant key with minimal privileges and rotation policy.

## Submission Safety Gates

`submit_mined_claim` and `attest_claim` are guarded by default:

1. `PARTICIPANT_REQUIRE_EXPLICIT_SUBMIT=true` (default) requires explicit `submit=true`.
2. `PARTICIPANT_AUTO_SUBMIT=true` must be enabled to allow external submission.
3. `RELAYER_URL` is validated; enforce trusted hosts with `PARTICIPANT_TRUSTED_RELAYER_HOSTS`.
4. Without submit approval, submit/attest returns `decision=READY` and does not transmit to relayer.

## Input

The skill supports four operational modes: **Mining**, **Verification**, **Submission**, and **Attestation**.

### Mode A: Mining (`mine_claim`)
Used to extract data from a source and create a claim.

```json
{
  "taskType": "mine_claim",
  "fundId": "string",
  "roomId": "string",
  "epochId": "number",
  "sourceSpec": {
    "sourceSpecId": "string",
    "sourceRef": "string",
    "extractor": "object",
    "freshnessSeconds": "number"
  },
  "tokenContext": {
    "symbol": "string",
    "address": "string"
  }
}
```

### Mode B: Verification (`verify_claim_or_intent_validity`)
Used to verify an existing claim or the technical validity of an intent.

```json
{
  "taskType": "verify_claim_or_intent_validity",
  "fundId": "string",
  "roomId": "string",
  "epochId": "number",
  "subjectType": "CLAIM | INTENT",
  "subjectHash": "string",
  "subjectPayload": "object",
  "validationPolicy": {
    "reproducible": "boolean",
    "maxDataAgeSeconds": "number"
  }
}
```

### Mode C: Submit (`submit_mined_claim`)
Submits canonical claim payload to relayer (only when explicit submit gate is passed).

```json
{
  "taskType": "submit_mined_claim",
  "fundId": "string",
  "epochId": "number",
  "observation": "object",
  "submit": "boolean (required for transmission when explicit-submit mode is enabled)"
}
```

### Mode D: Attest (`attest_claim`)
Signs and submits claim attestation envelope (only when explicit submit gate is passed).

```json
{
  "taskType": "attest_claim",
  "fundId": "string",
  "epochId": "number",
  "claimHash": "0x...",
  "submit": "boolean (required for transmission when explicit-submit mode is enabled)"
}
```

## Output

### Mining Output
```json
{
  "status": "OK",
  "taskType": "mine_claim",
  "fundId": "string",
  "epochId": "number",
  "observation": {
    "sourceSpecId": "string",
    "token": "string",
    "timestamp": "number",
    "extracted": "string",
    "responseHash": "string",
    "evidenceURI": "string",
    "crawler": "string"
  },
  "confidence": "number",
  "assumptions": ["string"]
}
```

### Verification Output
```json
{
  "status": "OK",
  "taskType": "verify_claim_or_intent_validity",
  "fundId": "string",
  "roomId": "string",
  "epochId": "number",
  "subjectType": "CLAIM | INTENT",
  "subjectHash": "string",
  "verdict": "PASS | FAIL | NEED_MORE_EVIDENCE",
  "reason": "string",
  "attestationDraft": {
    "validator": "string",
    "expiresAt": "number",
    "nonce": "number"
  },
  "confidence": "number",
  "assumptions": ["string"]
}
```

## Rules

1. **Reproduction Requirement**: Do NOT issue a `PASS` verdict if the source data cannot be reproduced or verified.
2. **Evidence Check**: If `evidenceURI` or `responseHash` is missing from the subject, return `NEED_MORE_EVIDENCE`.
3. **Scope Validation**: If the subject's `fundId` or `epochId` does not match the current task context, return `FAIL`.
4. **Key Hygiene**: Use only dedicated participant/verifier keys. Never use custody/admin keys for attest operations.
5. **Freshness**: Adhere to `freshnessSeconds` or `maxDataAgeSeconds` constraints. If data is stale, the verdict should reflect this.
6. **Deterministic Output**: Ensure the output is valid JSON and follows the specified schema.
7. **Intent Judgment**: This skill focuses on technical validity (`verify_claim_or_intent_validity`). Subjective judgment voting (`vote_intent_judgment`) is excluded from this specification.
8. **Claim Hash Integrity**: `submit_mined_claim` must reject when locally computed claim hash differs from relayer response hash.
9. **Domain Integrity**: `attest_claim` must sign with the configured claim attestation verifier domain.
10. **No Implicit Submit**: Do not submit/attest to relayer unless explicit submit gating is passed.
11. **Trusted Relayer**: In production, set `PARTICIPANT_TRUSTED_RELAYER_HOSTS` and avoid arbitrary relayer URLs.
