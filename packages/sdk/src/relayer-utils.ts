import { keccak256 } from "viem";
import { canonicalClaim, canonicalIntent } from "./canonical.js";
import {
  claimHash,
  intentExecutionAllowlistHash,
  intentHash,
  snapshotHashFromUnordered
} from "./hash.js";
import type {
  CanonicalClaimRecord,
  CanonicalIntentRecord,
  ClaimPayload,
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

export function buildCanonicalClaimRecord(input: {
  payload: ClaimPayload;
  epochId: bigint;
}): CanonicalClaimRecord {
  assertUint64(input.epochId, "epochId");
  assertUint64(input.payload.timestamp, "timestamp");

  const payload = canonicalClaim(input.payload);
  const hash = claimHash(payload);

  return {
    payload,
    epochId: input.epochId,
    claimHash: hash
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

export function buildCanonicalSnapshotRecord(input: {
  epochId: bigint;
  claimHashes: Hex[];
}) {
  assertUint64(input.epochId, "epochId");
  if (input.claimHashes.length === 0) {
    throw new Error("claimHashes must not be empty");
  }

  const hash = snapshotHashFromUnordered(input.epochId, input.claimHashes);
  return {
    epochId: input.epochId,
    snapshotHash: hash
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
