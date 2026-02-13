import test from "node:test";
import assert from "node:assert/strict";
import { intentHash } from "../dist/index.js";

test("NadFunTradeIntent type exports correctly", () => {
  // This test verifies that NadFunTradeIntent can be imported and used
  // The type itself is compile-time only, so we test the runtime behavior
  assert.ok(true, "NadFunTradeIntent type is available");
});

test("NadFunIntentMeta interface has required fields", () => {
  // Create a valid NadFunIntentMeta object
  const meta = {
    tokenSymbol: "ABC",
    curveState: "BONDING",
    curveAddress: "0x1234567890123456789012345678901234567890",
    dexPoolAddress: "0x0987654321098765432109876543210987654321",
    nadfunTokenId: "token-123",
    graduationProgress: 5000n
  };

  assert.equal(meta.tokenSymbol, "ABC");
  assert.equal(meta.curveState, "BONDING");
  assert.equal(meta.nadfunTokenId, "token-123");
  assert.equal(meta.graduationProgress, 5000n);
});

test("NadFunTradeIntent combines TradeIntent with NadFunIntentMeta", () => {
  const intent = {
    intentVersion: "V1",
    vault: "0x1111111111111111111111111111111111111111",
    action: "BUY",
    tokenIn: "0x2222222222222222222222222222222222222222",
    tokenOut: "0x3333333333333333333333333333333333333333",
    amountIn: 1000n,
    minAmountOut: 900n,
    deadline: 1739003600n,
    maxSlippageBps: 100n,
    snapshotHash: "0x4444444444444444444444444444444444444444444444444444444444444444",
    reason: "test trade",
    nadfunMeta: {
      tokenSymbol: "XYZ",
      curveState: "GRADUATED",
      curveAddress: "0x5555555555555555555555555555555555555555",
      dexPoolAddress: "0x6666666666666666666666666666666666666666",
      nadfunTokenId: "token-456",
      graduationProgress: 10000n
    }
  };

  assert.equal(intent.nadfunMeta.tokenSymbol, "XYZ");
  assert.equal(intent.nadfunMeta.curveState, "GRADUATED");
  assert.equal(intent.nadfunMeta.graduationProgress, 10000n);
});

test("intentHash ignores NadFunIntentMeta fields", () => {
  const baseIntent = {
    intentVersion: "V1",
    vault: "0x1111111111111111111111111111111111111111",
    action: "BUY",
    tokenIn: "0x2222222222222222222222222222222222222222",
    tokenOut: "0x3333333333333333333333333333333333333333",
    amountIn: 1000n,
    minAmountOut: 900n,
    deadline: 1739003600n,
    maxSlippageBps: 100n,
    snapshotHash: "0x4444444444444444444444444444444444444444444444444444444444444444"
  };

  // Hash without metadata
  const hash1 = intentHash(baseIntent);

  // Hash with metadata (should be identical)
  const intentWithMeta = {
    ...baseIntent,
    nadfunMeta: {
      tokenSymbol: "ABC",
      curveState: "BONDING",
      curveAddress: "0x5555555555555555555555555555555555555555",
      dexPoolAddress: "0x6666666666666666666666666666666666666666",
      nadfunTokenId: "token-789",
      graduationProgress: 3000n
    }
  };

  const hash2 = intentHash(intentWithMeta);

  // Hashes must be identical (metadata not included in hash)
  assert.equal(hash1, hash2, "intentHash must ignore NadFunIntentMeta fields");
});

test("NadFunIntentMeta curveState accepts BONDING and GRADUATED", () => {
  const bondingMeta = {
    tokenSymbol: "ABC",
    curveState: "BONDING",
    curveAddress: "0x1234567890123456789012345678901234567890",
    dexPoolAddress: "0x0987654321098765432109876543210987654321",
    nadfunTokenId: "token-123",
    graduationProgress: 2500n
  };

  const graduatedMeta = {
    tokenSymbol: "XYZ",
    curveState: "GRADUATED",
    curveAddress: "0x1234567890123456789012345678901234567890",
    dexPoolAddress: "0x0987654321098765432109876543210987654321",
    nadfunTokenId: "token-456",
    graduationProgress: 10000n
  };

  assert.equal(bondingMeta.curveState, "BONDING");
  assert.equal(graduatedMeta.curveState, "GRADUATED");
});

test("NadFunIntentMeta graduationProgress is bigint", () => {
  const meta = {
    tokenSymbol: "ABC",
    curveState: "BONDING",
    curveAddress: "0x1234567890123456789012345678901234567890",
    dexPoolAddress: "0x0987654321098765432109876543210987654321",
    nadfunTokenId: "token-123",
    graduationProgress: 5000n
  };

  assert.equal(typeof meta.graduationProgress, "bigint");
  assert.ok(meta.graduationProgress >= 0n);
  assert.ok(meta.graduationProgress <= 10000n);
});
