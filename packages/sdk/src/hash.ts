import { encodeAbiParameters, keccak256, parseAbiParameters, toHex } from "viem";
import { canonicalAllocationClaim, canonicalIntent } from "./canonical.js";
import { assertStrictlySortedHex, uniqueSortedBytes32Hex } from "./ordering.js";
import type { Address, AllocationClaimV1, Hex, TradeIntent } from "./types.js";
import { assertUint16, assertUint64 } from "./validate.js";

function assertUint256NonNegative(value: bigint, label: string): void {
  if (value < 0n) {
    throw new Error(`${label} must be uint256`);
  }
}

export function allocationClaimHash(claim: AllocationClaimV1): Hex {
  const v = canonicalAllocationClaim(claim);
  assertUint64(v.epochId, "epochId");
  assertUint64(v.horizonSec, "horizonSec");
  assertUint64(v.submittedAt, "submittedAt");
  assertUint256NonNegative(v.nonce, "nonce");
  if (v.targetWeights.length === 0) {
    throw new Error("targetWeights must not be empty");
  }
  v.targetWeights.forEach((weight, idx) => {
    assertUint256NonNegative(weight, `targetWeights[${idx}]`);
  });

  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "string claimVersion,string fundId,uint64 epochId,address participant,uint256[] targetWeights,uint64 horizonSec,uint256 nonce,uint64 submittedAt"
      ),
      [
        v.claimVersion,
        v.fundId,
        v.epochId,
        v.participant,
        v.targetWeights,
        v.horizonSec,
        v.nonce,
        v.submittedAt
      ]
    )
  );
}

export function intentHash(intent: TradeIntent): Hex {
  const v = canonicalIntent(intent);
  assertUint64(v.deadline, "deadline");
  assertUint16(v.maxSlippageBps, "maxSlippageBps");
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "string intentVersion,address vault,string action,address tokenIn,address tokenOut,uint256 amountIn,uint256 minAmountOut,uint64 deadline,uint16 maxSlippageBps,bytes32 snapshotHash"
      ),
      [
        v.intentVersion,
        v.vault,
        v.action,
        v.tokenIn,
        v.tokenOut,
        v.amountIn,
        v.minAmountOut,
        v.deadline,
        Number(v.maxSlippageBps),
        v.snapshotHash
      ]
    )
  );
}

export function snapshotHash(epochId: bigint, orderedClaimHashes: Hex[]): Hex {
  assertUint64(epochId, "epochId");
  assertStrictlySortedHex(orderedClaimHashes);
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters("uint64 epochId,bytes32[] orderedClaimHashes"),
      [epochId, orderedClaimHashes]
    )
  );
}

export function canonicalOrderedClaimHashes(claimHashes: Hex[]): Hex[] {
  return uniqueSortedBytes32Hex(claimHashes);
}

export function snapshotHashFromUnordered(epochId: bigint, claimHashes: Hex[]): Hex {
  const orderedClaimHashes = canonicalOrderedClaimHashes(claimHashes);
  return snapshotHash(epochId, orderedClaimHashes);
}

const MERKLE_NODE_PAIR = parseAbiParameters("bytes32 a, bytes32 b");
const EPOCH_STATE_HASH_INPUT = parseAbiParameters("uint64 epochId,bytes32 merkleRoot");

function merkleHashPair(a: Hex, b: Hex): Hex {
  const left = a.toLowerCase() < b.toLowerCase() ? a : b;
  const right = left === a ? b : a;
  return keccak256(encodeAbiParameters(MERKLE_NODE_PAIR, [left, right]));
}

/**
 * Deterministic Merkle root for strictly-sorted bytes32 leaves using commutative keccak256.
 * - Leaves must be strictly sorted ascending with no duplicates.
 * - If a layer has an odd number of nodes, the last node is duplicated.
 */
export function merkleRoot(orderedLeaves: Hex[]): Hex {
  if (orderedLeaves.length === 0) {
    throw new Error("leaves must not be empty");
  }
  assertStrictlySortedHex(orderedLeaves, "orderedLeaves");

  let layer = [...orderedLeaves];
  while (layer.length > 1) {
    const next: Hex[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i];
      const right = i + 1 < layer.length ? layer[i + 1] : layer[i];
      next.push(merkleHashPair(left, right));
    }
    layer = next;
  }
  return layer[0];
}

export function merkleRootFromUnorderedLeaves(leaves: Hex[]): Hex {
  const ordered = uniqueSortedBytes32Hex(leaves);
  return merkleRoot(ordered);
}

/**
 * Epoch state hash used as the onchain/offchain snapshot root.
 * Compatible with {SnapshotBook} + {IntentBook} snapshot gating.
 */
export function epochStateHash(epochId: bigint, orderedClaimHashes: Hex[]): Hex {
  assertUint64(epochId, "epochId");
  const root = merkleRoot(orderedClaimHashes);
  return keccak256(encodeAbiParameters(EPOCH_STATE_HASH_INPUT, [epochId, root]));
}

export function epochStateHashFromUnordered(epochId: bigint, claimHashes: Hex[]): Hex {
  assertUint64(epochId, "epochId");
  const ordered = canonicalOrderedClaimHashes(claimHashes);
  return epochStateHash(epochId, ordered);
}

export function merkleProof(orderedLeaves: Hex[], leaf: Hex): Hex[] {
  assertStrictlySortedHex(orderedLeaves, "orderedLeaves");
  if (orderedLeaves.length === 0) {
    throw new Error("orderedLeaves must not be empty");
  }

  const normalizedLeaf = leaf.toLowerCase() as Hex;
  const index0 = orderedLeaves.findIndex((entry) => entry.toLowerCase() === normalizedLeaf);
  if (index0 < 0) {
    throw new Error("leaf not found in orderedLeaves");
  }

  const proof: Hex[] = [];
  let index = index0;
  let layer = [...orderedLeaves];

  while (layer.length > 1) {
    const siblingIndex = index ^ 1; // toggle last bit
    const sibling = siblingIndex < layer.length ? layer[siblingIndex] : layer[index];
    proof.push(sibling);

    const next: Hex[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i];
      const right = i + 1 < layer.length ? layer[i + 1] : layer[i];
      next.push(merkleHashPair(left, right));
    }

    layer = next;
    index = Math.floor(index / 2);
  }

  return proof;
}

export function merkleProofFromUnorderedLeaves(leaves: Hex[], leaf: Hex): Hex[] {
  const ordered = uniqueSortedBytes32Hex(leaves);
  return merkleProof(ordered, leaf);
}

export function reasonHash(reason: string): Hex {
  return keccak256(toHex(reason.normalize("NFC").trim()));
}

/**
 * Canonical allowlist hash for intent execution route.
 * Must match ClawCore allowlist verification logic.
 */
export function intentExecutionAllowlistHash(
  tokenIn: Address,
  tokenOut: Address,
  quoteAmountOut: bigint,
  minAmountOut: bigint,
  adapter: Address,
  adapterDataHash: Hex
): Hex {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "address tokenIn,address tokenOut,uint256 quoteAmountOut,uint256 minAmountOut,address adapter,bytes32 adapterDataHash"
      ),
      [tokenIn, tokenOut, quoteAmountOut, minAmountOut, adapter, adapterDataHash]
    )
  );
}

/**
 * Helper that hashes raw adapter calldata before building the allowlist hash.
 */
export function intentExecutionCallHash(
  tokenIn: Address,
  tokenOut: Address,
  quoteAmountOut: bigint,
  minAmountOut: bigint,
  adapter: Address,
  adapterData: Hex
): Hex {
  return intentExecutionAllowlistHash(
    tokenIn,
    tokenOut,
    quoteAmountOut,
    minAmountOut,
    adapter,
    keccak256(adapterData)
  );
}
