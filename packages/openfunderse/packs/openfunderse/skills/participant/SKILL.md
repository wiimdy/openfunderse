---
name: participant-skill
description: Participant MoltBot for data mining (claims) and cross-verification (attestations)
metadata:
  openclaw:
    requires:
      env:
        - RELAYER_URL
        - PARTICIPANT_PRIVATE_KEY
---

# Participant MoltBot Skill

The Participant MoltBot is responsible for mining data claims from specified sources and verifying claims or intents proposed by other agents. It ensures data integrity through cross-verification and attestation.

## Input

The skill supports two primary modes: **Mining** and **Verification**.

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
3. **Scope Validation**: If the subject's `fundId` or `epochId` does not match the current task context, return `REJECTED`.
4. **No Private Keys**: The agent should not handle private keys directly; signing is assumed to be performed by a separate secure signer module.
5. **Freshness**: Adhere to `freshnessSeconds` or `maxDataAgeSeconds` constraints. If data is stale, the verdict should reflect this.
6. **Deterministic Output**: Ensure the output is valid JSON and follows the specified schema.
7. **Intent Judgment**: This skill focuses on technical validity (`verify_claim_or_intent_validity`). Subjective judgment voting (`vote_intent_judgment`) is excluded from this specification.
