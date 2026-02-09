import type { Hex } from "./types.js";

function normalizeHex(value: Hex): Hex {
  return value.toLowerCase() as Hex;
}

export function sortBytes32Hex(values: Hex[]): Hex[] {
  return [...values].map(normalizeHex).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function uniqueSortedBytes32Hex(values: Hex[]): Hex[] {
  return [...new Set(sortBytes32Hex(values))];
}

export function isStrictlySortedHex(values: Hex[]): boolean {
  for (let i = 1; i < values.length; i += 1) {
    if (values[i - 1].toLowerCase() >= values[i].toLowerCase()) {
      return false;
    }
  }
  return true;
}

export function assertStrictlySortedHex(values: Hex[], label = "orderedClaimHashes"): void {
  if (!isStrictlySortedHex(values)) {
    throw new Error(`${label} must be strictly sorted ascending with no duplicates`);
  }
}
