import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeNadfunExecutionDataV1,
  encodeNadfunExecutionDataV1,
  intentExecutionCallHash
} from "../dist/index.js";

test("nadfun execution data v1 roundtrip", () => {
  const payload = {
    version: 1,
    action: "BUY",
    venue: "NADFUN_BONDING_CURVE",
    router: "0x00000000000000000000000000000000000000a1",
    recipient: "0x00000000000000000000000000000000000000b2",
    token: "0x00000000000000000000000000000000000000c3",
    deadline: 1739966400n,
    amountOutMin: 123456789n,
    extra: "0x1234"
  };

  const encoded = encodeNadfunExecutionDataV1(payload);
  const decoded = decodeNadfunExecutionDataV1(encoded);

  assert.equal(decoded.version, payload.version);
  assert.equal(decoded.action, payload.action);
  assert.equal(decoded.venue, payload.venue);
  assert.equal(decoded.router.toLowerCase(), payload.router.toLowerCase());
  assert.equal(decoded.recipient.toLowerCase(), payload.recipient.toLowerCase());
  assert.equal(decoded.token.toLowerCase(), payload.token.toLowerCase());
  assert.equal(decoded.deadline, payload.deadline);
  assert.equal(decoded.amountOutMin, payload.amountOutMin);
  assert.equal(decoded.extra, payload.extra);
});

test("execution call hash changes when encoded data changes", () => {
  const base = {
    version: 1,
    action: "SELL",
    venue: "NADFUN_DEX",
    router: "0x00000000000000000000000000000000000000a1",
    recipient: "0x00000000000000000000000000000000000000b2",
    token: "0x00000000000000000000000000000000000000c3",
    deadline: 1739966400n,
    amountOutMin: 100n,
    extra: "0x"
  };

  const a = encodeNadfunExecutionDataV1(base);
  const b = encodeNadfunExecutionDataV1({ ...base, amountOutMin: 101n });
  const hashA = intentExecutionCallHash(
    "0x0000000000000000000000000000000000000011",
    "0x0000000000000000000000000000000000000022",
    "0x0000000000000000000000000000000000000033",
    a
  );
  const hashB = intentExecutionCallHash(
    "0x0000000000000000000000000000000000000011",
    "0x0000000000000000000000000000000000000022",
    "0x0000000000000000000000000000000000000033",
    b
  );

  assert.notEqual(hashA, hashB);
});

test("decoder rejects unsupported version", () => {
  const encoded = encodeNadfunExecutionDataV1({
    version: 1,
    action: "BUY",
    venue: "NADFUN_BONDING_CURVE",
    router: "0x00000000000000000000000000000000000000a1",
    recipient: "0x00000000000000000000000000000000000000b2",
    token: "0x00000000000000000000000000000000000000c3",
    deadline: 1739966400n,
    amountOutMin: 100n,
    extra: "0x"
  });
  const wrongVersionEncoded = `0x${"0".repeat(63)}2${encoded.slice(66)}`;

  assert.throws(() => decodeNadfunExecutionDataV1(wrongVersionEncoded), /unsupported execution-data version/);
});
