import { encodeFunctionData } from "viem";
import type { Hex } from "./types.js";

export const ERC1271_MAGIC_VALUE = "0x1626ba7e";

const ERC1271_ABI = [
  {
    type: "function",
    name: "isValidSignature",
    stateMutability: "view",
    inputs: [
      { name: "hash", type: "bytes32" },
      { name: "signature", type: "bytes" }
    ],
    outputs: [{ name: "magicValue", type: "bytes4" }]
  }
] as const;

export function encodeErc1271IsValidSignatureCall(hash: Hex, signature: Hex): Hex {
  return encodeFunctionData({
    abi: ERC1271_ABI,
    functionName: "isValidSignature",
    args: [hash, signature]
  });
}

export function isValidErc1271Result(result: Hex): boolean {
  return result.slice(0, 10).toLowerCase() === ERC1271_MAGIC_VALUE;
}
