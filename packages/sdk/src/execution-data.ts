import {
  decodeAbiParameters,
  encodeAbiParameters,
  parseAbiParameters
} from "viem";
import type {
  ExecutionAction,
  ExecutionVenue,
  Hex,
  NadfunExecutionDataV1
} from "./types.js";
import { assertUint64 } from "./validate.js";

const NADFUN_V1_ABI = parseAbiParameters(
  "uint8 version,uint8 action,uint8 venue,address router,address recipient,address token,uint64 deadline,uint256 amountOutMin,bytes extra"
);

const ACTION_TO_ID: Record<ExecutionAction, number> = {
  BUY: 1,
  SELL: 2
};

const VENUE_TO_ID: Record<ExecutionVenue, number> = {
  NADFUN_BONDING_CURVE: 1,
  NADFUN_DEX: 2
};

const ID_TO_ACTION: Record<number, ExecutionAction> = {
  1: "BUY",
  2: "SELL"
};

const ID_TO_VENUE: Record<number, ExecutionVenue> = {
  1: "NADFUN_BONDING_CURVE",
  2: "NADFUN_DEX"
};

function assertVersion(version: number): asserts version is 1 {
  if (version !== 1) {
    throw new Error(`unsupported execution-data version: ${version}`);
  }
}

function assertKnownAction(actionId: number): ExecutionAction {
  const action = ID_TO_ACTION[actionId];
  if (!action) throw new Error(`unsupported action id: ${actionId}`);
  return action;
}

function assertKnownVenue(venueId: number): ExecutionVenue {
  const venue = ID_TO_VENUE[venueId];
  if (!venue) throw new Error(`unsupported venue id: ${venueId}`);
  return venue;
}

export function encodeNadfunExecutionDataV1(data: NadfunExecutionDataV1): Hex {
  assertUint64(data.deadline, "deadline");
  return encodeAbiParameters(NADFUN_V1_ABI, [
    data.version,
    ACTION_TO_ID[data.action],
    VENUE_TO_ID[data.venue],
    data.router,
    data.recipient,
    data.token,
    data.deadline,
    data.amountOutMin,
    data.extra
  ]);
}

export function decodeNadfunExecutionDataV1(raw: Hex): NadfunExecutionDataV1 {
  const [
    version,
    actionId,
    venueId,
    router,
    recipient,
    token,
    deadline,
    amountOutMin,
    extra
  ] = decodeAbiParameters(NADFUN_V1_ABI, raw);

  const v = Number(version);
  assertVersion(v);

  return {
    version: 1,
    action: assertKnownAction(Number(actionId)),
    venue: assertKnownVenue(Number(venueId)),
    router,
    recipient,
    token,
    deadline,
    amountOutMin,
    extra
  };
}
