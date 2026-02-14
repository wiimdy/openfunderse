import test from "node:test";
import assert from "node:assert/strict";
import vectors from "./vectors.json" with { type: "json" };
import {
  allocationClaimHash,
  intentHash,
  snapshotHash,
  snapshotHashFromUnordered,
  canonicalOrderedClaimHashes,
  reasonHash
} from "../dist/index.js";

function toTradeIntent(v) {
  return {
    ...v,
    amountIn: BigInt(v.amountIn),
    minAmountOut: BigInt(v.minAmountOut),
    deadline: BigInt(v.deadline),
    maxSlippageBps: BigInt(v.maxSlippageBps)
  };
}

test("allocationClaimHash is stable under trim + address normalization", () => {
  const base = {
    claimVersion: "v1",
    fundId: "fund-alpha",
    epochId: 12n,
    participant: "0x00000000000000000000000000000000000000A1",
    targetWeights: [5000n, 3000n, 2000n],
    horizonSec: 3600n,
    nonce: 9n,
    submittedAt: 1700000000n
  };

  const left = allocationClaimHash({
    ...base,
    fundId: "  fund-alpha  "
  });
  const right = allocationClaimHash({
    ...base,
    participant: "0x00000000000000000000000000000000000000a1"
  });

  assert.equal(left, right);
});

test("allocationClaimHash enforces uint64 boundaries", () => {
  const base = {
    claimVersion: "v1",
    fundId: "fund-alpha",
    epochId: 1n,
    participant: "0x00000000000000000000000000000000000000a1",
    targetWeights: [1n],
    horizonSec: 1n,
    nonce: 0n,
    submittedAt: 1n
  };

  assert.doesNotThrow(() => allocationClaimHash(base));
  assert.throws(() => allocationClaimHash({ ...base, epochId: 1n << 64n }));
  assert.throws(() => allocationClaimHash({ ...base, horizonSec: 1n << 64n }));
  assert.throws(() => allocationClaimHash({ ...base, submittedAt: 1n << 64n }));
});

test("intentHash/snapshotHash match fixed vectors", () => {
  for (const v of vectors.vectors) {
    const intent = toTradeIntent(v.tradeIntent);
    const epochId = BigInt(v.snapshot.epochId);

    assert.equal(intentHash(intent), v.expectedIntentHash, `${v.id}: intentHash mismatch`);
    assert.equal(
      snapshotHash(epochId, v.snapshot.orderedClaimHashes),
      v.snapshot.expectedSnapshotHash,
      `${v.id}: snapshotHash mismatch`
    );
  }
});

test("snapshotHashFromUnordered canonicalizes order and de-duplicates", () => {
  const v = vectors.vectors[0];
  const epochId = BigInt(v.snapshot.epochId);
  const unordered = [
    v.snapshot.orderedClaimHashes[1],
    v.snapshot.orderedClaimHashes[0],
    v.snapshot.orderedClaimHashes[1]
  ];

  const canonical = canonicalOrderedClaimHashes(unordered);
  assert.deepEqual(canonical, v.snapshot.orderedClaimHashes);
  assert.equal(snapshotHashFromUnordered(epochId, unordered), v.snapshot.expectedSnapshotHash);
});

test("snapshotHash rejects non-strict ordering", () => {
  const v = vectors.vectors[0];
  const epochId = BigInt(v.snapshot.epochId);
  const unordered = [v.snapshot.orderedClaimHashes[1], v.snapshot.orderedClaimHashes[0]];
  assert.throws(() => snapshotHash(epochId, unordered));
});

test("intentHash rejects invalid action and out-of-range uint16", () => {
  const base = toTradeIntent(vectors.vectors[0].tradeIntent);
  assert.throws(() => intentHash({ ...base, action: "HOLD" }));
  assert.throws(() => intentHash({ ...base, maxSlippageBps: 70000n }));
});

test("reasonHash is stable under trim + NFC normalization", () => {
  const left = reasonHash("  Cafe\u0301 signal  ");
  const right = reasonHash("Caf\u00E9 signal");
  assert.equal(left, right);
});
