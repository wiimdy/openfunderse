# Evidence Policy (POC Baseline)

## Required fields
- `sourceRef`: stable identifier for the source (URL, chain+address, pool id, etc.)
- `extractor`: re-runnable extraction recipe (CSS selector / JSONPath / regex / ABI call / RPC query)
- `evidenceURI`: pointer to raw artifact used to compute `extracted` and `responseHash`
- `responseHash`: hash of the raw artifact (or an explicitly defined subset)
- `timestamp`: when extraction occurred (RFC3339)

## EvidenceURI guidance
Accepted types:
- `https://...` for web/API
- `file://...` or absolute path for local artifacts

Avoid:
- “copied text” with no raw backing
- screenshots without the underlying text/JSON response (unless the UI is the only source)

## Hashing guidance
- For EVM commitments use Keccak-256 on canonical JSON bytes.
- Canonical JSON must be deterministic across languages; prefer RFC 8785 (JCS).

