import { parseAbi, type Address, type PublicClient } from "viem";

export const SNAPSHOT_BOOK_ABI = parseAbi([
  "function publishSnapshot(bytes32 snapshotRoot)",
  "function isSnapshotFinalized(bytes32 snapshotHash) view returns (bool)"
]);

const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

export interface SnapshotBookValidation {
  address: string;
  hasCode: boolean;
  isSnapshotFinalizedCallable: boolean;
  errors: string[];
}

/**
 * Validates that `address` implements the SnapshotBook interface:
 *   1. `eth_getCode` is non-empty (not an EOA / self-destructed)
 *   2. `isSnapshotFinalized(bytes32(0))` returns `bool` without revert
 */
export async function validateSnapshotBookInterface(
  client: PublicClient,
  address: Address
): Promise<SnapshotBookValidation> {
  const result: SnapshotBookValidation = {
    address,
    hasCode: false,
    isSnapshotFinalizedCallable: false,
    errors: []
  };

  try {
    const code = await client.getCode({ address });
    result.hasCode = !!code && code !== "0x";
    if (!result.hasCode) {
      result.errors.push(
        `address ${address} has no deployed bytecode (EOA or self-destructed)`
      );
      return result;
    }
  } catch (error) {
    result.errors.push(
      `eth_getCode(${address}) failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return result;
  }

  try {
    const returnValue = await client.readContract({
      address,
      abi: SNAPSHOT_BOOK_ABI,
      functionName: "isSnapshotFinalized",
      args: [ZERO_HASH]
    });
    result.isSnapshotFinalizedCallable = typeof returnValue === "boolean";
    if (!result.isSnapshotFinalizedCallable) {
      result.errors.push(
        `isSnapshotFinalized(bytes32(0)) returned non-boolean (${typeof returnValue})`
      );
    }
  } catch (error) {
    result.errors.push(
      `isSnapshotFinalized(bytes32(0)) reverted: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return result;
}

export function isSnapshotBookValid(v: SnapshotBookValidation): boolean {
  return v.hasCode && v.isSnapshotFinalizedCallable && v.errors.length === 0;
}
