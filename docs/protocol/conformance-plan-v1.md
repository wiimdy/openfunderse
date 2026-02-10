# Conformance Plan (v1)

Purpose: ensure every component computes exactly the same `claimHash` / `intentHash` / `snapshotHash` and applies the same EIP-712 typed data.

## 0. Runtime Model

Status (`2026-02-10`):
- Weighted threshold from onchain validator snapshot is the only canonical model.

## 1. Target Components

- Agent implementations (crawler, verifier, strategy)
- Relayer server (`next_Front`)
- UI / client code
- Smart contracts tests
- Shared SDK (`@claw/protocol-sdk`)

## 2. Required Fixture

Single source of truth:
- `packages/sdk/test/vectors.json`

Must not duplicate expected hashes in code comments or local constants.

## 3. Test Matrix

For each vector in `test-vectors.json`, every component MUST pass:

1. `claimHash(claimPayload) == expectedClaimHash`
2. `snapshotHash(epochId, orderedClaimHashes) == expectedSnapshotHash`
3. `intentHash(tradeIntent) == expectedIntentHash`

Weighted attestation:

4. with a fixed validator snapshot, `attestedWeight(attesters, snapshotWeights)` matches expected
5. `reachedWeightedThreshold(attesters, snapshotWeights, thresholdWeight)` matches expected

Plus negative tests:

1. snapshot ordering violated (unsorted / duplicates) -> reject
2. invalid `action` (not BUY/SELL) -> reject
3. out-of-range `uint64`/`uint16` fields -> reject
4. duplicated validator entries in snapshot weights -> reject
5. non-positive `thresholdWeight` -> reject

## 4. EIP-712 Conformance

Typed data structures MUST match:

- `ClaimAttestation(bytes32 claimHash,uint64 epochId,address verifier,uint64 expiresAt,uint256 nonce)`
- `IntentAttestation(bytes32 intentHash,address verifier,uint64 expiresAt,uint256 nonce)`

Domain MUST include:
- `name`, `version`, `chainId`, `verifyingContract`

Runtime checks:
- reject expired signatures (`expiresAt <= now`)
- enforce nonce replay policy per verifier

## 5. Execution Plan by Layer

### 5.1 SDK
- Unit tests consume `packages/sdk/test/vectors.json`.
- Verify all positive and negative matrix cases.

### 5.2 Relayer / Next server
- On attestation ingestion:
  - recompute subject hash from payload via SDK
  - verify EIP-712 signature (EOA)
  - verify ERC-1271 for smart-wallet verifiers if configured
  - load onchain validator snapshot and apply weighted threshold helpers from SDK

### 5.3 Agent services
- For claim submit/sign and intent sign:
  - compute only through SDK
  - no local hash implementation allowed

### 5.4 Contracts tests
- Load same vectors in Foundry tests.
- Assert onchain helper/hash implementation equals vector expected values.

## 6. CI Gate

PR is blocked unless:

1. SDK vector tests pass
2. Agent/relayer vector tests pass
3. Contract vector tests pass
4. Any spec change updates both:
   - `docs/protocol/hashing-eip712-v1.md`
   - `packages/sdk/test/vectors.json`
