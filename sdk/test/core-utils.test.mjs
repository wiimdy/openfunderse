import test from "node:test";
import assert from "node:assert/strict";
import {
  assertSameScope,
  canonicalScope,
  scopeKey,
  scopedSnapshotHash,
  encodeErc1271IsValidSignatureCall,
  isValidErc1271Result,
  ERC1271_MAGIC_VALUE
} from "../dist/index.js";

test("scope canonicalization normalizes text and keeps epoch", () => {
  const s = canonicalScope({
    fundId: "  fund-001  ",
    roomId: " room-alpha ",
    epochId: 12n
  });
  assert.equal(s.fundId, "fund-001");
  assert.equal(s.roomId, "room-alpha");
  assert.equal(s.epochId, 12n);
  assert.equal(scopeKey(s), "fund-001:room-alpha:12");
});

test("assertSameScope rejects mismatched scope", () => {
  assert.doesNotThrow(() =>
    assertSameScope(
      { fundId: "fund-001", roomId: "room-a", epochId: 1n },
      { fundId: "fund-001", roomId: "room-a", epochId: 1n }
    )
  );
  assert.throws(() =>
    assertSameScope(
      { fundId: "fund-001", roomId: "room-a", epochId: 1n },
      { fundId: "fund-001", roomId: "room-b", epochId: 1n }
    )
  );
});

test("scopedSnapshotHash is deterministic for equivalent canonical input", () => {
  const snapshotHash = "0x2497dde4cc715472e57f7be6422feb6f2bde4cd55eac1f6c0e4788692f06c973";
  const left = scopedSnapshotHash(
    { fundId: " fund-001 ", roomId: " room-a ", epochId: 12n },
    snapshotHash
  );
  const right = scopedSnapshotHash(
    { fundId: "fund-001", roomId: "room-a", epochId: 12n },
    snapshotHash
  );
  assert.equal(left, right);
});

test("ERC-1271 calldata encoder includes function selector and args", () => {
  const hash = "0x3aad4f1da71a80fccb5d5842524dd1f8cf23b1e072fc6d74860abd0f0246b3ae";
  const signature = "0x1234";
  const calldata = encodeErc1271IsValidSignatureCall(hash, signature);

  assert.equal(calldata.startsWith(ERC1271_MAGIC_VALUE), true);
  assert.equal(calldata.length > 10, true);
  assert.equal(isValidErc1271Result("0x1626ba7e"), true);
  assert.equal(isValidErc1271Result("0xffffffff"), false);
});
