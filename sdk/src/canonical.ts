import { getAddress } from "viem";
import type { ClaimPayload, TradeIntent } from "./types.js";

function normalizeText(value: string): string {
  return value.normalize("NFC").trim();
}

function normalizeAddress(value: `0x${string}`): `0x${string}` {
  return getAddress(value);
}

export function canonicalClaim(input: ClaimPayload): ClaimPayload {
  return {
    ...input,
    schemaId: normalizeText(input.schemaId),
    sourceType: normalizeText(input.sourceType),
    sourceRef: normalizeText(input.sourceRef),
    selector: normalizeText(input.selector),
    extracted: normalizeText(input.extracted),
    extractedType: normalizeText(input.extractedType),
    evidenceType: normalizeText(input.evidenceType),
    evidenceURI: normalizeText(input.evidenceURI),
    crawler: normalizeAddress(input.crawler),
    notes: input.notes === undefined ? undefined : normalizeText(input.notes)
  };
}

export function canonicalIntent(input: TradeIntent): TradeIntent {
  const normalizedAction = normalizeText(input.action).toUpperCase();
  if (normalizedAction !== "BUY" && normalizedAction !== "SELL") {
    throw new Error(`invalid action: ${input.action}`);
  }

  return {
    ...input,
    intentVersion: normalizeText(input.intentVersion),
    vault: normalizeAddress(input.vault),
    action: normalizedAction as "BUY" | "SELL",
    tokenIn: normalizeAddress(input.tokenIn),
    tokenOut: normalizeAddress(input.tokenOut),
    reason: input.reason === undefined ? undefined : normalizeText(input.reason)
  };
}
