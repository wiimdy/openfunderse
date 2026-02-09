import test from "node:test";
import assert from "node:assert/strict";
import vectors from "./vectors.json" with { type: "json" };
import {
  claimHash,
  intentHash,
  snapshotHash,
  snapshotHashFromUnordered,
  canonicalOrderedClaimHashes
} from "../dist/index.js";

function toClaimPayload(v) {
  return {
    ...v,
    timestamp: BigInt(v.timestamp)
  };
}

function toTradeIntent(v) {
  return {
    ...v,
    amountIn: BigInt(v.amountIn),
    minAmountOut: BigInt(v.minAmountOut),
    deadline: BigInt(v.deadline),
    maxSlippageBps: BigInt(v.maxSlippageBps)
  };
}

test("claimHash/intentHash/snapshotHash match fixed vectors", () => {
  for (const v of vectors.vectors) {
    const claim = toClaimPayload(v.claimPayload);
    const intent = toTradeIntent(v.tradeIntent);
    const epochId = BigInt(v.snapshot.epochId);

    assert.equal(claimHash(claim), v.expectedClaimHash, `${v.id}: claimHash mismatch`);
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
