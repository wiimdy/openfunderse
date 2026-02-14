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

export const epochStateHash = snapshotHash;
export const epochStateHashFromUnordered = snapshotHashFromUnordered;

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
