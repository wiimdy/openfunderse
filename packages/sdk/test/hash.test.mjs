import test from "node:test";
import assert from "node:assert/strict";
import vectors from "./vectors.json" with { type: "json" };
import {
  claimHash,
  intentHash,
  snapshotHash,
  snapshotHashFromUnordered,
  canonicalOrderedClaimHashes,
  reasonHash
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

test("claimHash is stable under trimming + NFC normalization + address case", () => {
  const base = toClaimPayload(vectors.vectors[0].claimPayload);
  const decomposed = "Cafe\u0301";
  const composed = "Caf\u00E9";

  const a = claimHash({
    ...base,
    schemaId: `  ${base.schemaId}  `,
    evidenceType: decomposed,
    notes: "  hello  ",
    crawler: "0x1111111111111111111111111111111111111111"
  });

  const b = claimHash({
    ...base,
    schemaId: base.schemaId,
    evidenceType: composed,
    notes: "hello",
    crawler: "0x1111111111111111111111111111111111111111"
  });

  assert.equal(a, b);
});

test("reasonHash is stable under trim + NFC normalization", () => {
  const left = reasonHash("  Cafe\u0301 signal  ");
  const right = reasonHash("Caf\u00E9 signal");
  assert.equal(left, right);
});

test("uint64 boundaries are enforced", () => {
  const claim = toClaimPayload(vectors.vectors[0].claimPayload);
  assert.doesNotThrow(() => claimHash({ ...claim, timestamp: 0n }));
  assert.doesNotThrow(() => claimHash({ ...claim, timestamp: (1n << 64n) - 1n }));
  assert.throws(() => claimHash({ ...claim, timestamp: 1n << 64n }));

  const intent = toTradeIntent(vectors.vectors[0].tradeIntent);
  assert.doesNotThrow(() => intentHash({ ...intent, deadline: 0n }));
  assert.doesNotThrow(() => intentHash({ ...intent, deadline: (1n << 64n) - 1n }));
  assert.throws(() => intentHash({ ...intent, deadline: 1n << 64n }));
});

test("ClaimBook hash conformance: snapshotHash matches Solidity keccak256(abi.encode(epochId, orderedClaimHashes))", () => {
  // Test vector from ClaimBook.t.sol: claimHash1 = keccak256("claim-1"), claimHash2 = keccak256("claim-2")
  const claimBookVector = vectors.vectors.find(v => v.id === "claimbook-vector-1");
  assert(claimBookVector, "ClaimBook test vector not found");

  const epochId = BigInt(claimBookVector.snapshot.epochId);
  const orderedClaimHashes = claimBookVector.snapshot.orderedClaimHashes;
  const expectedSnapshotHash = claimBookVector.snapshot.expectedSnapshotHash;

  const computed = snapshotHash(epochId, orderedClaimHashes);
  assert.equal(computed, expectedSnapshotHash, "snapshotHash mismatch for ClaimBook vector");
});

test("ClaimBook hash conformance: claimHash computation", () => {
  const claimBookVector = vectors.vectors.find(v => v.id === "claimbook-vector-1");
  assert(claimBookVector, "ClaimBook test vector not found");

  const claim = toClaimPayload(claimBookVector.claimPayload);
  const computed = claimHash(claim);
  assert.equal(computed, claimBookVector.expectedClaimHash, "claimHash mismatch for ClaimBook vector");
});
