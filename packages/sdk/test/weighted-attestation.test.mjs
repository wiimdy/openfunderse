import test from "node:test";
import assert from "node:assert/strict";
import {
  attestedWeight,
  buildValidatorWeightMap,
  reachedWeightedThreshold,
  totalValidatorWeight,
  weightedThresholdState
} from "../dist/weighted-attestation.js";

const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000b2";
const C = "0x00000000000000000000000000000000000000c3";

test("buildValidatorWeightMap builds a normalized map", () => {
  const map = buildValidatorWeightMap([
    { validator: A, weight: 5n },
    { validator: B, weight: 3n }
  ]);

  assert.equal(map.get(A.toLowerCase()), 5n);
  assert.equal(map.get(B.toLowerCase()), 3n);
  assert.equal(totalValidatorWeight(map), 8n);
});

test("buildValidatorWeightMap rejects duplicate validators", () => {
  assert.throws(() =>
    buildValidatorWeightMap([
      { validator: A, weight: 2n },
      { validator: A.toUpperCase(), weight: 4n }
    ])
  );
});

test("buildValidatorWeightMap rejects negative and zero weights by default", () => {
  assert.throws(() =>
    buildValidatorWeightMap([{ validator: A, weight: -1n }])
  );
  assert.throws(() =>
    buildValidatorWeightMap([{ validator: A, weight: 0n }])
  );
});

test("buildValidatorWeightMap allows zero only when explicitly enabled", () => {
  const map = buildValidatorWeightMap([{ validator: A, weight: 0n }], {
    allowZeroWeight: true
  });
  assert.equal(map.get(A.toLowerCase()), 0n);
});

test("attestedWeight deduplicates attesters and ignores unknown validators", () => {
  const map = buildValidatorWeightMap([
    { validator: A, weight: 7n },
    { validator: B, weight: 2n }
  ]);

  const weight = attestedWeight([A, A.toUpperCase(), C], map);

  assert.equal(weight, 7n);
});

test("reachedWeightedThreshold checks absolute weight threshold", () => {
  const map = buildValidatorWeightMap([
    { validator: A, weight: 6n },
    { validator: B, weight: 4n }
  ]);

  assert.equal(reachedWeightedThreshold([A], map, 6n), true);
  assert.equal(reachedWeightedThreshold([B], map, 6n), false);
  assert.equal(reachedWeightedThreshold([A, B], map, 10n), true);
});

test("weightedThresholdState returns total/attested/threshold summary", () => {
  const map = buildValidatorWeightMap([
    { validator: A, weight: 9n },
    { validator: B, weight: 1n }
  ]);

  const state = weightedThresholdState([A], map, 7n);

  assert.deepEqual(state, {
    totalWeight: 10n,
    attestedWeight: 9n,
    thresholdWeight: 7n,
    met: true
  });
});

test("reachedWeightedThreshold rejects non-positive threshold", () => {
  const map = buildValidatorWeightMap([{ validator: A, weight: 1n }]);
  assert.throws(() => reachedWeightedThreshold([A], map, 0n));
});
