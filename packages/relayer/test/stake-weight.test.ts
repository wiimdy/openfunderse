import assert from "node:assert/strict";
import test from "node:test";
import { validateStakeWeightInput } from "../lib/stake-validation.ts";

test("valid positive weight returns ok with normalized address", () => {
  const result = validateStakeWeightInput({
    participant: " 0xAbCdEf0000000000000000000000000000001234 ",
    weight: "42"
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.participant, "0xabcdef0000000000000000000000000000001234");
    assert.equal(result.weight, BigInt(42));
  }
});

test("weight of zero is accepted", () => {
  const result = validateStakeWeightInput({
    participant: "0x1111111111111111111111111111111111111111",
    weight: "0"
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.weight, BigInt(0));
  }
});

test("negative weight is rejected", () => {
  const result = validateStakeWeightInput({
    participant: "0x2222222222222222222222222222222222222222",
    weight: "-1"
  });

  assert.deepEqual(result, { ok: false, message: "weight must be non-negative" });
});

test("non-numeric weight is rejected", () => {
  const result = validateStakeWeightInput({
    participant: "0x3333333333333333333333333333333333333333",
    weight: "abc"
  });

  assert.deepEqual(result, { ok: false, message: "weight must be a valid integer" });
});

test("invalid address is rejected", () => {
  const result = validateStakeWeightInput({
    participant: "0x123",
    weight: "5"
  });

  assert.deepEqual(result, {
    ok: false,
    message: "participant must be a valid 20-byte hex address"
  });
});

test("empty participant is rejected", () => {
  const result = validateStakeWeightInput({
    participant: "   ",
    weight: "5"
  });

  assert.deepEqual(result, {
    ok: false,
    message: "participant must be a valid 20-byte hex address"
  });
});

test("very large weight is accepted", () => {
  const large = "340282366920938463463374607431768211455";
  const result = validateStakeWeightInput({
    participant: "0x9999999999999999999999999999999999999999",
    weight: large
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.weight, BigInt(large));
  }
});
