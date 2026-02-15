import assert from "node:assert/strict";
import test from "node:test";
import {
  filterAndWeighClaims,
  computeStakeWeightedAggregate,
  type ClaimEntry,
} from "../lib/aggregate-logic.ts";

const SCALE = 1_000_000_000_000_000_000n; // 1e18 — matches CLAIM_WEIGHT_SCALE

const PARTICIPANT_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const PARTICIPANT_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const PARTICIPANT_C = "0xcccccccccccccccccccccccccccccccccccccccc";

function makeWeights6(fractions: number[]): bigint[] {
  assert.equal(fractions.length, 6, "must provide 6 fractions");
  const raw = fractions.map((f) => BigInt(Math.floor(f * 1e18)));
  const sum = raw.reduce((a, b) => a + b, 0n);
  raw[0] += SCALE - sum;
  return raw;
}

test("filterAndWeighClaims: unregistered participant excluded", () => {
  const claims: ClaimEntry[] = [
    { participant: PARTICIPANT_A, weights: makeWeights6([1, 0, 0, 0, 0, 0]), claimHash: "0xaaa" }
  ];
  const result = filterAndWeighClaims({
    claims,
    registeredParticipants: new Set<string>(),
    stakeMap: new Map([[PARTICIPANT_A, 100n]]),
    expectedDimensions: 6
  });

  assert.equal(result.included.length, 0);
  assert.deepEqual(result.skipped.unregistered, [PARTICIPANT_A]);
});

test("filterAndWeighClaims: no stake → excluded (no BigInt(1) fallback)", () => {
  const claims: ClaimEntry[] = [
    { participant: PARTICIPANT_A, weights: makeWeights6([0.5, 0.1, 0.1, 0.1, 0.1, 0.1]), claimHash: "0xaaa" }
  ];
  const result = filterAndWeighClaims({
    claims,
    registeredParticipants: new Set([PARTICIPANT_A]),
    stakeMap: new Map(),
    expectedDimensions: 6
  });

  assert.equal(result.included.length, 0);
  assert.deepEqual(result.skipped.noStake, [PARTICIPANT_A]);
});

test("filterAndWeighClaims: stake=0 → excluded", () => {
  const claims: ClaimEntry[] = [
    { participant: PARTICIPANT_A, weights: makeWeights6([1, 0, 0, 0, 0, 0]), claimHash: "0xaaa" }
  ];
  const result = filterAndWeighClaims({
    claims,
    registeredParticipants: new Set([PARTICIPANT_A]),
    stakeMap: new Map([[PARTICIPANT_A, 0n]]),
    expectedDimensions: 6
  });

  assert.equal(result.included.length, 0);
  assert.deepEqual(result.skipped.noStake, [PARTICIPANT_A]);
});

test("filterAndWeighClaims: dimension mismatch excluded (3 weights vs expected 6)", () => {
  const claims: ClaimEntry[] = [
    { participant: PARTICIPANT_A, weights: [SCALE / 3n, SCALE / 3n, SCALE / 3n], claimHash: "0xaaa" }
  ];
  const result = filterAndWeighClaims({
    claims,
    registeredParticipants: new Set([PARTICIPANT_A]),
    stakeMap: new Map([[PARTICIPANT_A, 10n]]),
    expectedDimensions: 6
  });

  assert.equal(result.included.length, 0);
  assert.deepEqual(result.skipped.dimensionMismatch, [PARTICIPANT_A]);
});

test("filterAndWeighClaims: expectedDimensions=null → first valid claim sets dimension", () => {
  const w6 = makeWeights6([0.2, 0.2, 0.2, 0.2, 0.1, 0.1]);
  const w3 = [SCALE / 3n, SCALE / 3n, SCALE / 3n];
  const claims: ClaimEntry[] = [
    { participant: PARTICIPANT_A, weights: w6, claimHash: "0xaaa" },
    { participant: PARTICIPANT_B, weights: w3, claimHash: "0xbbb" }
  ];
  const result = filterAndWeighClaims({
    claims,
    registeredParticipants: new Set([PARTICIPANT_A, PARTICIPANT_B]),
    stakeMap: new Map([
      [PARTICIPANT_A, 5n],
      [PARTICIPANT_B, 5n]
    ]),
    expectedDimensions: null
  });

  assert.equal(result.included.length, 1);
  assert.equal(result.included[0].participant, PARTICIPANT_A);
  assert.deepEqual(result.skipped.dimensionMismatch, [PARTICIPANT_B]);
});

test("filterAndWeighClaims: all valid → all included with correct stake", () => {
  const wA = makeWeights6([0.5, 0.1, 0.1, 0.1, 0.1, 0.1]);
  const wB = makeWeights6([0.1, 0.5, 0.1, 0.1, 0.1, 0.1]);
  const claims: ClaimEntry[] = [
    { participant: PARTICIPANT_A, weights: wA, claimHash: "0xaaa" },
    { participant: PARTICIPANT_B, weights: wB, claimHash: "0xbbb" }
  ];
  const result = filterAndWeighClaims({
    claims,
    registeredParticipants: new Set([PARTICIPANT_A, PARTICIPANT_B]),
    stakeMap: new Map([
      [PARTICIPANT_A, 100n],
      [PARTICIPANT_B, 200n]
    ]),
    expectedDimensions: 6
  });

  assert.equal(result.included.length, 2);
  assert.equal(result.included[0].stake, 100n);
  assert.equal(result.included[1].stake, 200n);
  assert.equal(result.skipped.unregistered.length, 0);
  assert.equal(result.skipped.noStake.length, 0);
  assert.equal(result.skipped.dimensionMismatch.length, 0);
});

test("computeStakeWeightedAggregate: equal stake → simple average", () => {
  // 100% ZEN vs 100% tFOMA, equal stake → expect ~50/50
  const wA = makeWeights6([1, 0, 0, 0, 0, 0]);
  const wB = makeWeights6([0, 1, 0, 0, 0, 0]);
  const result = computeStakeWeightedAggregate(
    [
      { weights: wA, stake: 10n },
      { weights: wB, stake: 10n }
    ],
    6
  );

  const sum = result.reduce((a, b) => a + b, 0n);
  assert.equal(sum, SCALE, "aggregate must sum to SCALE");
  assert.ok(result[0] >= SCALE / 2n - 1n && result[0] <= SCALE / 2n + 1n);
  assert.ok(result[1] >= SCALE / 2n - 1n && result[1] <= SCALE / 2n + 1n);
});

test("computeStakeWeightedAggregate: unequal stake → weighted toward heavier", () => {
  // stake 3:1 ratio → expect ~75/25 split
  const wA = makeWeights6([1, 0, 0, 0, 0, 0]);
  const wB = makeWeights6([0, 1, 0, 0, 0, 0]);
  const result = computeStakeWeightedAggregate(
    [
      { weights: wA, stake: 3n },
      { weights: wB, stake: 1n }
    ],
    6
  );

  const sum = result.reduce((a, b) => a + b, 0n);
  assert.equal(sum, SCALE);
  assert.ok(result[0] >= (SCALE * 3n) / 4n - 1n && result[0] <= (SCALE * 3n) / 4n + 1n);
  assert.ok(result[1] >= SCALE / 4n - 1n && result[1] <= SCALE / 4n + 1n);
});

test("computeStakeWeightedAggregate: single participant → same weights", () => {
  const w = makeWeights6([0.3, 0.2, 0.15, 0.15, 0.1, 0.1]);
  const result = computeStakeWeightedAggregate([{ weights: w, stake: 42n }], 6);

  const sum = result.reduce((a, b) => a + b, 0n);
  assert.equal(sum, SCALE);
  assert.deepEqual(result, w);
});

test("computeStakeWeightedAggregate: rounding remainder → sum equals SCALE", () => {
  // 3 participants with prime-number stakes to force integer division rounding
  const wA = makeWeights6([0.333, 0.333, 0.334, 0, 0, 0]);
  const wB = makeWeights6([0, 0, 0, 0.333, 0.333, 0.334]);
  const wC = makeWeights6([0.167, 0.167, 0.166, 0.167, 0.167, 0.166]);

  const result = computeStakeWeightedAggregate(
    [
      { weights: wA, stake: 7n },
      { weights: wB, stake: 11n },
      { weights: wC, stake: 13n }
    ],
    6
  );

  const sum = result.reduce((a, b) => a + b, 0n);
  assert.equal(sum, SCALE, "aggregate must always sum to SCALE after rounding correction");
});

test("computeStakeWeightedAggregate: empty participants → throws", () => {
  assert.throws(
    () => computeStakeWeightedAggregate([], 6),
    { message: "cannot compute aggregate with zero participants" }
  );
});

test("computeStakeWeightedAggregate: 6-token realistic scenario with 3 participants", () => {
  // A(stake=5): 40%ZEN 20%tFOMA 10%×4 | B(stake=3): 50%MONAI 10%×5 | C(stake=2): ~16.67%×6
  const wA = makeWeights6([0.40, 0.20, 0.10, 0.10, 0.10, 0.10]);
  const wB = makeWeights6([0.10, 0.10, 0.50, 0.10, 0.10, 0.10]);
  const wC = makeWeights6([1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6]);

  const result = computeStakeWeightedAggregate(
    [
      { weights: wA, stake: 5n },
      { weights: wB, stake: 3n },
      { weights: wC, stake: 2n }
    ],
    6
  );

  const sum = result.reduce((a, b) => a + b, 0n);
  assert.equal(sum, SCALE, "aggregate must sum to SCALE");

  for (let i = 0; i < 6; i++) {
    assert.ok(result[i] > 0n, `result[${i}] should be positive`);
  }

  assert.ok(result[0] > result[3], "ZEN should be weighted higher than PFROG");
  assert.ok(result[2] > result[3], "MONAI should be weighted higher than PFROG");
});
