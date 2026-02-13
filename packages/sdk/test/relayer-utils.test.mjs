import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCanonicalClaimRecord,
  buildCanonicalIntentRecord,
  buildCanonicalSnapshotRecord,
  buildCoreExecutionRequestFromIntent,
  buildIntentAllowlistHashFromRoute,
  intentExecutionCallHash
} from "../dist/index.js";

test("buildCanonicalClaimRecord normalizes claim and hashes", () => {
  const out = buildCanonicalClaimRecord({
    payload: {
      schemaId: " score_v1 ",
      sourceType: " WEB ",
      sourceRef: " https://example.com ",
      selector: " .score ",
      extracted: " 123 ",
      extractedType: " uint ",
      timestamp: 100n,
      responseHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
      evidenceType: " recrawl ",
      evidenceURI: " ipfs://abc ",
      crawler: "0x00000000000000000000000000000000000000a1"
    },
    epochId: 1n
  });

  assert.equal(out.payload.schemaId, "score_v1");
  assert.equal(out.epochId, 1n);
  assert.equal(out.claimHash.startsWith("0x"), true);
});

test("buildCanonicalIntentRecord validates deadline and constraints", () => {
  const out = buildCanonicalIntentRecord({
    intent: {
      intentVersion: " v1 ",
      vault: "0x00000000000000000000000000000000000000a1",
      action: "buy",
      tokenIn: "0x00000000000000000000000000000000000000b2",
      tokenOut: "0x00000000000000000000000000000000000000c3",
      amountIn: 1000n,
      minAmountOut: 900n,
      deadline: 9999999999n,
      maxSlippageBps: 300n,
      snapshotHash: "0x2222222222222222222222222222222222222222222222222222222222222222"
    },
    allowlistHash: "0x3333333333333333333333333333333333333333333333333333333333333333",
    maxNotional: 1000n,
    now: 1n
  });

  assert.equal(out.intent.action, "BUY");
  assert.equal(out.constraints.maxSlippageBps, 300n);
  assert.equal(out.intentHash.startsWith("0x"), true);
});

test("buildCanonicalSnapshotRecord rejects empty claim hashes", () => {
  assert.throws(
    () =>
      buildCanonicalSnapshotRecord({
        epochId: 1n,
        claimHashes: []
      }),
    /must not be empty/
  );
});

test("buildIntentAllowlistHashFromRoute matches direct call hash", () => {
  const route = {
    tokenIn: "0x00000000000000000000000000000000000000a1",
    tokenOut: "0x00000000000000000000000000000000000000b2",
    quoteAmountOut: 1000n,
    minAmountOut: 980n,
    adapter: "0x00000000000000000000000000000000000000c3",
    adapterData: "0x12345678"
  };

  const fromRoute = buildIntentAllowlistHashFromRoute(route);
  const direct = intentExecutionCallHash(
    route.tokenIn,
    route.tokenOut,
    route.quoteAmountOut,
    route.minAmountOut,
    route.adapter,
    route.adapterData
  );

  assert.equal(fromRoute, direct);
});

test("buildIntentAllowlistHashFromRoute requires adapterData*", () => {
  assert.throws(
    () =>
      buildIntentAllowlistHashFromRoute({
        tokenIn: "0x00000000000000000000000000000000000000a1",
        tokenOut: "0x00000000000000000000000000000000000000b2",
        quoteAmountOut: 1000n,
        minAmountOut: 980n,
        adapter: "0x00000000000000000000000000000000000000c3"
      }),
    /adapterData/
  );
});

test("buildCoreExecutionRequestFromIntent validates route consistency", () => {
  const intent = {
    intentVersion: "v1",
    vault: "0x00000000000000000000000000000000000000a1",
    action: "BUY",
    tokenIn: "0x00000000000000000000000000000000000000b2",
    tokenOut: "0x00000000000000000000000000000000000000c3",
    amountIn: 1000n,
    minAmountOut: 900n,
    deadline: 9999999999n,
    maxSlippageBps: 300n,
    snapshotHash: "0x2222222222222222222222222222222222222222222222222222222222222222"
  };

  const req = buildCoreExecutionRequestFromIntent({
    intent,
    executionRoute: {
      tokenIn: intent.tokenIn,
      tokenOut: intent.tokenOut,
      quoteAmountOut: 950n,
      minAmountOut: intent.minAmountOut,
      adapter: "0x00000000000000000000000000000000000000d4",
      adapterData: "0x1234"
    }
  });
  assert.equal(req.amountIn, 1000n);
  assert.equal(req.adapterData, "0x1234");
});
