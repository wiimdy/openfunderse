# @claw/protocol-sdk

Claw protocol canonical hashing, EIP-712 typed-data, and shared protocol utilities.

## Scope

- Canonical normalization for `ClaimPayload` and `TradeIntent`
- Hash helpers: `claimHash`, `intentHash`, `snapshotHash`
- Snapshot ordering helpers: sort/unique/assert order
- Scope helpers: `fundId` / `roomId` / `epochId` canonicalization and scope checks
- Replay helpers: expiry/nonce validation
- EIP-712 typed data builders:
  - `ClaimAttestation`
  - `IntentAttestation`
- EIP-712 digest/signature verification helpers
- ERC-1271 helper utilities

## Install

```bash
npm install @claw/protocol-sdk
```

For local development in this repository:

```bash
cd /Users/ham-yunsig/Documents/github/claw-validation-market/sdk
npm install
npm run build
```

## Usage

```ts
import {
  claimHash,
  intentHash,
  snapshotHashFromUnordered,
  canonicalScope,
  assertNotExpired,
  assertNonceStrictlyIncreases,
  claimAttestationTypedData,
  intentAttestationTypedData,
  verifyClaimAttestation
} from "@claw/protocol-sdk";
```

## API (Current)

- `canonicalClaim`, `canonicalIntent`
- `claimHash`, `intentHash`, `snapshotHash`, `snapshotHashFromUnordered`, `reasonHash`
- `sortBytes32Hex`, `uniqueSortedBytes32Hex`, `assertStrictlySortedHex`
- `canonicalScope`, `scopeKey`, `assertSameScope`, `scopedSnapshotHash`
- `claimAttestationTypedData`, `intentAttestationTypedData`
- `claimAttestationDigest`, `intentAttestationDigest`
- `verifyClaimAttestation`, `verifyIntentAttestation`
- `recoverClaimAttester`, `recoverIntentAttester`
- `encodeErc1271IsValidSignatureCall`, `isValidErc1271Result`
- `isExpired`, `assertNotExpired`, `assertNonceStrictlyIncreases`

## Integration Direction

- `next_Front` (relayer server): verify payload -> compute hash via this SDK -> build EIP-712 typed data -> sign/verify
- `moltbot` services: never implement hashing locally; always call this SDK
- contracts tests: import the same test vectors and assert equality with onchain hash functions

## Coverage vs Technical Docs

Implemented in SDK:
- canonical hashing path for `claimHash`, `intentHash`
- deterministic `snapshotHash` helper + ordered claim hash utilities
- EIP-712 typed data for claim/intent attestation
- ERC-1271 integration helper for smart-wallet signature checks
- nonce/expiry utility guards for replay protection
- scope guard helpers for `fundId` / `roomId` / `epochId`

Still recommended next:
- keep fixed test vectors (`claim/intent/snapshot`) in `sdk/test/vectors.json`
- wire contract tests to the same vectors
- finalize one authoritative spec doc with field ordering and normalization rules

## Versioning

- Keep spec compatibility by semantic versioning.
- Breaking hashing/type changes must bump major and ship as new spec version (e.g. `v2`).
