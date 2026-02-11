import { encodeAbiParameters, keccak256, parseAbiParameters, toHex } from "viem";
import { canonicalClaim, canonicalIntent } from "./canonical.js";
import { assertStrictlySortedHex, uniqueSortedBytes32Hex } from "./ordering.js";
import type { Address, ClaimPayload, Hex, TradeIntent } from "./types.js";
import { assertUint16, assertUint64 } from "./validate.js";

export function claimHash(payload: ClaimPayload): Hex {
  const v = canonicalClaim(payload);
  assertUint64(v.timestamp, "timestamp");
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "string schemaId,string sourceType,string sourceRef,string selector,string extracted,string extractedType,uint64 timestamp,bytes32 responseHash,string evidenceType,string evidenceURI,address crawler,string notes"
      ),
      [
        v.schemaId,
        v.sourceType,
        v.sourceRef,
        v.selector,
        v.extracted,
        v.extractedType,
        v.timestamp,
        v.responseHash,
        v.evidenceType,
        v.evidenceURI,
        v.crawler,
        v.notes ?? ""
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
  adapter: Address,
  adapterDataHash: Hex
): Hex {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "address tokenIn,address tokenOut,address adapter,bytes32 adapterDataHash"
      ),
      [tokenIn, tokenOut, adapter, adapterDataHash]
    )
  );
}

/**
 * Helper that hashes raw adapter calldata before building the allowlist hash.
 */
export function intentExecutionCallHash(
  tokenIn: Address,
  tokenOut: Address,
  adapter: Address,
  adapterData: Hex
): Hex {
  return intentExecutionAllowlistHash(tokenIn, tokenOut, adapter, keccak256(adapterData));
}
