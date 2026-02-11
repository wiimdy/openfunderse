import type { Address } from "./types.js";

export interface ValidatorWeight {
  validator: Address;
  weight: bigint;
}

export interface WeightMapOptions {
  allowZeroWeight?: boolean;
}

export interface WeightedThresholdState {
  totalWeight: bigint;
  attestedWeight: bigint;
  thresholdWeight: bigint;
  met: boolean;
}

function toKey(address: Address): string {
  return address.toLowerCase();
}

export function buildValidatorWeightMap(
  entries: ValidatorWeight[],
  options: WeightMapOptions = {}
): Map<string, bigint> {
  const allowZeroWeight = options.allowZeroWeight ?? false;
  const map = new Map<string, bigint>();

  for (const entry of entries) {
    if (entry.weight < 0n) {
      throw new Error("weight must be non-negative");
    }
    if (!allowZeroWeight && entry.weight === 0n) {
      throw new Error("weight must be positive");
    }

    const key = toKey(entry.validator);
    if (map.has(key)) {
      throw new Error(`duplicate validator weight entry: ${entry.validator}`);
    }
    map.set(key, entry.weight);
  }

  return map;
}

export function totalValidatorWeight(weightMap: Map<string, bigint>): bigint {
  let total = 0n;
  for (const weight of weightMap.values()) {
    total += weight;
  }
  return total;
}

export function attestedWeight(
  attesters: Address[],
  weightMap: Map<string, bigint>
): bigint {
  let total = 0n;
  const seen = new Set<string>();

  for (const attester of attesters) {
    const key = toKey(attester);
    if (seen.has(key)) continue;
    seen.add(key);

    const weight = weightMap.get(key);
    if (weight !== undefined) {
      total += weight;
    }
  }

  return total;
}

export function reachedWeightedThreshold(
  attesters: Address[],
  weightMap: Map<string, bigint>,
  thresholdWeight: bigint
): boolean {
  if (thresholdWeight <= 0n) {
    throw new Error("thresholdWeight must be positive");
  }
  return attestedWeight(attesters, weightMap) >= thresholdWeight;
}

export function weightedThresholdState(
  attesters: Address[],
  weightMap: Map<string, bigint>,
  thresholdWeight: bigint
): WeightedThresholdState {
  if (thresholdWeight <= 0n) {
    throw new Error("thresholdWeight must be positive");
  }

  const totalWeight = totalValidatorWeight(weightMap);
  const reachedWeight = attestedWeight(attesters, weightMap);

  return {
    totalWeight,
    attestedWeight: reachedWeight,
    thresholdWeight,
    met: reachedWeight >= thresholdWeight
  };
}
