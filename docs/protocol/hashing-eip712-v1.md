# Canonical Hashing + EIP-712 Spec (v1)

This document is the normative spec for `claimHash`, `intentHash`, `snapshotHash`, and attestation typed data.

## 1. Canonical Encoding Rules

### 1.1 Common
- Hash function: `keccak256`.
- ABI encoding: `abi.encode` equivalent (not `abi.encodePacked`).
- String normalization: Unicode NFC + trim (`value.normalize("NFC").trim()`).
- Address normalization: EIP-55 checksum address.
- Integer bounds:
  - `uint16`: `0 <= value <= 65535`
  - `uint64`: `0 <= value <= 18446744073709551615`

### 1.2 ClaimPayload -> claimHash

Field order and ABI types are fixed:

1. `schemaId` (`string`)
2. `sourceType` (`string`)
3. `sourceRef` (`string`)
4. `selector` (`string`)
5. `extracted` (`string`)
6. `extractedType` (`string`)
7. `timestamp` (`uint64`)
8. `responseHash` (`bytes32`)
9. `evidenceType` (`string`)
10. `evidenceURI` (`string`)
11. `crawler` (`address`)
12. `notes` (`string`)

Optional handling:
- If `notes` is missing, canonical value is empty string `""`.

Formula:

`claimHash = keccak256(abi.encode(schemaId, sourceType, sourceRef, selector, extracted, extractedType, timestamp, responseHash, evidenceType, evidenceURI, crawler, notes))`

### 1.3 TradeIntent -> intentHash

Field order and ABI types are fixed:

1. `intentVersion` (`string`)
2. `vault` (`address`)
3. `action` (`string`)
4. `tokenIn` (`address`)
5. `tokenOut` (`address`)
6. `amountIn` (`uint256`)
7. `minAmountOut` (`uint256`)
8. `deadline` (`uint64`)
9. `maxSlippageBps` (`uint16`)
10. `snapshotHash` (`bytes32`)

Additional rule:
- `action` must be uppercase and one of: `BUY`, `SELL`.

Formula:

`intentHash = keccak256(abi.encode(intentVersion, vault, action, tokenIn, tokenOut, amountIn, minAmountOut, deadline, maxSlippageBps, snapshotHash))`

### 1.4 Snapshot -> snapshotHash

`snapshotHash` is deterministic only when `orderedClaimHashes` is strictly sorted.

Ordering rule:
- Sort ascending by lowercase hex string value.
- No duplicates allowed.
- Final list must be strictly increasing.

Formula:

`snapshotHash = keccak256(abi.encode(epochId, orderedClaimHashes))`

where:
- `epochId` is `uint64`
- `orderedClaimHashes` is `bytes32[]`

## 2. EIP-712 Typed Data (v1)

### 2.1 Domain

Domain fields:
- `name` (`string`)
- `version` (`string`)
- `chainId` (`uint256`)
- `verifyingContract` (`address`)

### 2.2 ClaimAttestation

Type:

`ClaimAttestation(bytes32 claimHash,uint64 epochId,address verifier,uint64 expiresAt,uint256 nonce)`

### 2.3 IntentAttestation

Type:

`IntentAttestation(bytes32 intentHash,address verifier,uint64 expiresAt,uint256 nonce)`

### 2.4 Replay Protection

- Every signed payload MUST include both `nonce` and `expiresAt`.
- `expiresAt` MUST be checked against current unix time.
- `nonce` MUST be unique per verifier/signing scope according to verifier policy.

## 3. Test Vectors

Authoritative vectors:
- `packages/sdk/test/vectors.json`

Vectors include:
- claim payload + expected `claimHash`
- ordered claim hashes + expected `snapshotHash`
- trade intent + expected `intentHash`

## 4. Onchain Snapshot-Based Weighted Attestation

Status (`2026-02-10`):
- Canonical attestation threshold model is weighted-only.
- Relayer/agents must evaluate threshold from onchain validator snapshot.

### 4.1 Validator Snapshot

- Source of truth is onchain snapshot at deterministic block/epoch-finalization point.
- Snapshot row shape:
  - `validator` (`address`)
  - `weight` (`uint256`)
- Snapshot constraints:
  - no duplicate validator addresses
  - every weight is positive
- snapshot id `(fundId, epochId, blockNumber)` is immutable after finalization

### 4.2 Weighted Threshold

Definition:
- `W(v)`: validator weight from snapshot
- `A`: unique attesters for one subject (`claimHash` or `intentHash`)
- `T`: configured threshold weight (`uint256`)

Rule:
- `attestedWeight = sum(W(v) for v in A where v exists in snapshot)`
- threshold satisfied iff `attestedWeight >= T`

Notes:
- duplicate signatures from same validator count once
- attesters not in snapshot contribute `0`
- `T` must be strictly positive

### 4.3 Runtime Requirement

- Runtime threshold check MUST use `attestedWeight >= thresholdWeight`.
- Non-weighted threshold models are out of scope for this spec.

## 5. Intent Settlement Route Hash (v1)

`constraints.allowlistHash` is the canonical execution-route commitment used by settlement contracts.

Formula:

`allowlistHash = keccak256(abi.encode(tokenIn, tokenOut, quoteAmountOut, minAmountOut, adapter, keccak256(adapterData)))`

where:
- `tokenIn` is input asset address
- `tokenOut` is output asset address
- `adapter` is execution adapter contract address
- `adapterData` is opaque calldata for adapter/router execution

Rationale:
- binds the approved intent to an exact route + calldata payload shape
- prevents post-approval adapter-data substitution

NadFun mapping guidance:
- `adapter` should represent a dedicated execution adapter for NadFun trading venues
- `adapterData` should encode the concrete router call payload (e.g. buy/sell params, deadline, min-out), so hash commitment includes venue-level execution details
