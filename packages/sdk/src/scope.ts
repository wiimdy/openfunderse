import { encodeAbiParameters, keccak256, parseAbiParameters } from "viem";
import type { Hex, ProtocolScope } from "./types.js";

const SCOPE_KEY_INPUT = parseAbiParameters("string fundId,string roomId,uint64 epochId");

function normalizeScopeText(value: string): string {
  return value.normalize("NFC").trim();
}

export function canonicalScope(input: ProtocolScope): ProtocolScope {
  return {
    fundId: normalizeScopeText(input.fundId),
    roomId: normalizeScopeText(input.roomId),
    epochId: input.epochId
  };
}

export function scopeKey(input: ProtocolScope): Hex {
  const v = canonicalScope(input);
  return keccak256(encodeAbiParameters(SCOPE_KEY_INPUT, [v.fundId, v.roomId, v.epochId]));
}

export function assertSameScope(expected: ProtocolScope, received: ProtocolScope): void {
  const left = scopeKey(expected);
  const right = scopeKey(received);
  if (left !== right) {
    throw new Error(`scope mismatch: expected=${left}, received=${right}`);
  }
}

export function scopedSnapshotHash(
  scope: ProtocolScope,
  snapshotHash: Hex
): Hex {
  const v = canonicalScope(scope);
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters("string fundId,string roomId,uint64 epochId,bytes32 snapshotHash"),
      [v.fundId, v.roomId, v.epochId, snapshotHash]
    )
  );
}
