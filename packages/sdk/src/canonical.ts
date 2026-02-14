import { getAddress } from "viem";
import type { AllocationClaimV1, TradeIntent } from "./types.js";

function normalizeText(value: string): string {
  return value.normalize("NFC").trim();
}

function normalizeAddress(value: `0x${string}`): `0x${string}` {
  return getAddress(value);
}

function normalizeWeights(weights: bigint[]): bigint[] {
  return weights.map((weight) => {
    if (weight < 0n) {
      throw new Error("targetWeights must be non-negative");
    }
    return weight;
  });
}

export function canonicalAllocationClaim(input: AllocationClaimV1): AllocationClaimV1 {
  if (input.claimVersion !== "v1") {
    throw new Error(`unsupported claimVersion: ${input.claimVersion}`);
  }

  return {
    ...input,
    claimVersion: "v1",
    fundId: normalizeText(input.fundId),
    participant: normalizeAddress(input.participant),
    targetWeights: normalizeWeights(input.targetWeights)
  };
}

export function canonicalIntent(input: TradeIntent): TradeIntent {
  const normalizedAction = normalizeText(input.action).toUpperCase();
  if (normalizedAction !== "BUY" && normalizedAction !== "SELL") {
    throw new Error(`invalid action: ${input.action}`);
  }

  return {
    ...input,
    intentVersion: normalizeText(input.intentVersion),
    vault: normalizeAddress(input.vault),
    action: normalizedAction as "BUY" | "SELL",
    tokenIn: normalizeAddress(input.tokenIn),
    tokenOut: normalizeAddress(input.tokenOut),
    reason: input.reason === undefined ? undefined : normalizeText(input.reason)
  };
}
