import { Address, TradeIntent } from "./types.js";

/**
 * NadFun-specific metadata for offchain intent context.
 * These fields are NOT included in intentHash computation.
 * They provide additional context for strategy/verifier agents.
 */
export interface NadFunIntentMeta {
  /** Token symbol (e.g., "ABC") */
  tokenSymbol: string;

  /** Bonding curve state: BONDING (pre-graduation) or GRADUATED (post-graduation) */
  curveState: "BONDING" | "GRADUATED";

  /** Bonding curve contract address (valid when curveState === "BONDING") */
  curveAddress: Address;

  /** DEX pool address (valid when curveState === "GRADUATED") */
  dexPoolAddress: Address;

  /** NadFun platform token ID */
  nadfunTokenId: string;

  /** Graduation progress in basis points (0-10000) */
  graduationProgress: bigint;
}

/**
 * Extended trade intent combining canonical TradeIntent with NadFun metadata.
 * The intentHash is computed only from TradeIntent fields.
 * Metadata fields are for offchain context and agent decision-making.
 */
export interface NadFunTradeIntent extends TradeIntent {
  /** NadFun-specific metadata (not included in hash) */
  nadfunMeta: NadFunIntentMeta;
}
