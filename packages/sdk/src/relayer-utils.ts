import { keccak256 } from "viem";
import { canonicalAllocationClaim, canonicalIntent } from "./canonical.js";
import { CLAIM_WEIGHT_SCALE } from "./constants.js";
import {
  allocationClaimHash,
  intentExecutionAllowlistHash,
  intentHash,
  epochStateHashFromUnordered
} from "./hash.js";
import type {
  AllocationClaimV1,
  CanonicalAllocationClaimRecord,
  CanonicalIntentRecord,
  CoreExecutionRequestInput,
  Hex,
  IntentExecutionRouteInput,
  IntentConstraints,
  TradeIntent
} from "./types.js";
import { assertUint16, assertUint64 } from "./validate.js";

function assertPositive(value: bigint, label: string): void {
  if (value <= 0n) {
    throw new Error(`${label} must be positive`);
  }
}

function assertHex32(value: string, label: string): asserts value is Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${label} must be 0x-prefixed 32-byte hex`);
  }
}

function assertWeightsSumPositive(weights: bigint[]): void {
  const sum = weights.reduce((acc, w) => acc + w, 0n);
  if (sum <= 0n) {
    throw new Error("targetWeights sum must be positive");
  }
}

function assertWeightsSumEqualsScale(weights: bigint[]): void {
  const sum = weights.reduce((acc, w) => acc + w, 0n);
  if (sum !== CLAIM_WEIGHT_SCALE) {
    throw new Error(
      `targetWeights sum must equal CLAIM_WEIGHT_SCALE (${CLAIM_WEIGHT_SCALE}), got ${sum}`
    );
  }
}

export function buildCanonicalAllocationClaimRecord(input: {
  claim: AllocationClaimV1;
}): CanonicalAllocationClaimRecord {
  assertUint64(input.claim.epochId, "epochId");
  assertUint64(input.claim.horizonSec, "horizonSec");
  assertUint64(input.claim.submittedAt, "submittedAt");
  if (input.claim.nonce < 0n) {
    throw new Error("nonce must be non-negative");
  }

  const claim = canonicalAllocationClaim(input.claim);
  if (claim.targetWeights.length === 0) {
    throw new Error("targetWeights must not be empty");
  }
  claim.targetWeights.forEach((weight, idx) => {
    if (weight < 0n) {
      throw new Error(`targetWeights[${idx}] must be non-negative`);
    }
  });
  assertWeightsSumPositive(claim.targetWeights);
  assertWeightsSumEqualsScale(claim.targetWeights);

  return {
    claim,
    claimHash: allocationClaimHash(claim)
  };
}

export function buildIntentConstraints(input: {
  allowlistHash: Hex;
  maxSlippageBps: bigint;
  maxNotional: bigint;
  deadline: bigint;
}): IntentConstraints {
  assertHex32(input.allowlistHash, "allowlistHash");
  assertUint16(input.maxSlippageBps, "maxSlippageBps");
  assertUint64(input.deadline, "deadline");
  assertPositive(input.maxNotional, "maxNotional");

  return {
    allowlistHash: input.allowlistHash,
    maxSlippageBps: input.maxSlippageBps,
    maxNotional: input.maxNotional,
    deadline: input.deadline
  };
}

export function buildCanonicalIntentRecord(input: {
  intent: TradeIntent;
  allowlistHash: Hex;
  maxNotional: bigint;
  now?: bigint;
}): CanonicalIntentRecord {
  const intent = canonicalIntent(input.intent);
  assertUint64(intent.deadline, "deadline");
  assertUint16(intent.maxSlippageBps, "maxSlippageBps");
  assertPositive(intent.amountIn, "amountIn");
  assertPositive(intent.minAmountOut, "minAmountOut");

  if (intent.deadline <= (input.now ?? BigInt(Math.floor(Date.now() / 1000)))) {
    throw new Error("intent deadline is expired");
  }

  const constraints = buildIntentConstraints({
    allowlistHash: input.allowlistHash,
    maxSlippageBps: intent.maxSlippageBps,
    maxNotional: input.maxNotional,
    deadline: intent.deadline
  });

  return {
    intent,
    intentHash: intentHash(intent),
    constraints
  };
}

export function buildEpochStateRecord(input: {
  epochId: bigint;
  claimHashes: Hex[];
}) {
  assertUint64(input.epochId, "epochId");
  if (input.claimHashes.length === 0) {
    throw new Error("claimHashes must not be empty");
  }

  const hash = epochStateHashFromUnordered(input.epochId, input.claimHashes);
  return {
    epochId: input.epochId,
    epochStateHash: hash
  };
}

export function buildIntentAllowlistHashFromRoute(
  route: IntentExecutionRouteInput
): Hex {
  assertPositive(route.quoteAmountOut, "quoteAmountOut");
  assertPositive(route.minAmountOut, "minAmountOut");

  const adapterDataHash =
    route.adapterDataHash ??
    (route.adapterData ? keccak256(route.adapterData) : undefined);
  if (!adapterDataHash) {
    throw new Error("adapterData or adapterDataHash is required");
  }
  assertHex32(adapterDataHash, "adapterDataHash");

  return intentExecutionAllowlistHash(
    route.tokenIn,
    route.tokenOut,
    route.quoteAmountOut,
    route.minAmountOut,
    route.adapter,
    adapterDataHash
  );
}

export function buildCoreExecutionRequestFromIntent(input: {
  intent: TradeIntent;
  executionRoute: IntentExecutionRouteInput;
}): CoreExecutionRequestInput {
  const { intent, executionRoute } = input;
  assertPositive(intent.amountIn, "amountIn");
  assertPositive(intent.minAmountOut, "minAmountOut");
  assertPositive(executionRoute.quoteAmountOut, "quoteAmountOut");
  assertPositive(executionRoute.minAmountOut, "route.minAmountOut");

  if (executionRoute.tokenIn.toLowerCase() !== intent.tokenIn.toLowerCase()) {
    throw new Error("executionRoute.tokenIn must match intent.tokenIn");
  }
  if (executionRoute.tokenOut.toLowerCase() !== intent.tokenOut.toLowerCase()) {
    throw new Error("executionRoute.tokenOut must match intent.tokenOut");
  }
  if (executionRoute.minAmountOut !== intent.minAmountOut) {
    throw new Error("executionRoute.minAmountOut must match intent.minAmountOut");
  }
  if (!executionRoute.adapterData) {
    throw new Error("executionRoute.adapterData is required for execution");
  }

  return {
    tokenIn: executionRoute.tokenIn,
    tokenOut: executionRoute.tokenOut,
    amountIn: intent.amountIn,
    quoteAmountOut: executionRoute.quoteAmountOut,
    minAmountOut: executionRoute.minAmountOut,
    adapter: executionRoute.adapter,
    adapterData: executionRoute.adapterData
  };
}
