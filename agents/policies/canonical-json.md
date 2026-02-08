# Canonical JSON Rules (POC Baseline)

Goal: make `canonical_json(obj)` deterministic across languages so `claimHash/intentHash` are stable.

## Rules
- Encode as UTF-8 JSON text.
- Objects: keys sorted lexicographically by Unicode code points.
- No insignificant whitespace (use separators `,` and `:`).
- Disallow non-finite numbers (`NaN`, `Infinity`).
- **Avoid floats**: represent large ints/decimals as strings inside `extracted.value`.
  - Example: `"value": "1.2345"` (string), not a JSON number.

## Recommendation
If you need strict cross-language canonicalization, implement RFC 8785 (JCS).
This POC baseline stays safe by constraining numeric fields to strings.

