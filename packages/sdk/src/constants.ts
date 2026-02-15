/**
 * Canonical weight scale for allocation claims (1e18).
 * Every claim's `targetWeights` MUST sum to exactly this value.
 * Example: 50/50 split = [500000000000000000n, 500000000000000000n]
 */
export const CLAIM_WEIGHT_SCALE = 1_000_000_000_000_000_000n;
