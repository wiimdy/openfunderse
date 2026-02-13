export type Hex = `0x${string}`;

export type Address = `0x${string}`;

export interface ClaimPayload {
  schemaId: string;
  sourceType: string;
  sourceRef: string;
  selector: string;
  extracted: string;
  extractedType: string;
  timestamp: bigint;
  responseHash: Hex;
  evidenceType: string;
  evidenceURI: string;
  crawler: Address;
  notes?: string;
}

export interface TradeIntent {
  intentVersion: string;
  vault: Address;
  action: "BUY" | "SELL";
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  minAmountOut: bigint;
  deadline: bigint;
  maxSlippageBps: bigint;
  snapshotHash: Hex;
  reason?: string;
}

export interface Eip712DomainInput {
  name: string;
  version: string;
  chainId: bigint;
  verifyingContract: Address;
}

export interface ProtocolScope {
  fundId: string;
  roomId: string;
  epochId: bigint;
}

export type SubjectType = "CLAIM" | "INTENT";

export interface AttestationMeta {
  verifier: Address;
  expiresAt: bigint;
  nonce: bigint;
}

export interface ClaimAttestationDraft extends AttestationMeta {
  claimHash: Hex;
  epochId: bigint;
}

export interface IntentAttestationDraft extends AttestationMeta {
  intentHash: Hex;
}

export interface SignedAttestation<TSubject extends SubjectType, TMessage> {
  subjectType: TSubject;
  subjectHash: Hex;
  message: TMessage;
  signature: Hex;
}

export type ExecutionAction = "BUY" | "SELL";
export type ExecutionVenue = "NADFUN_BONDING_CURVE" | "NADFUN_DEX";

export interface NadfunExecutionDataV1 {
  version: 1;
  action: ExecutionAction;
  venue: ExecutionVenue;
  router: Address;
  recipient: Address;
  token: Address;
  deadline: bigint;
  amountOutMin: bigint;
  extra: Hex;
}

export interface IntentConstraints {
  allowlistHash: Hex;
  maxSlippageBps: bigint;
  maxNotional: bigint;
  deadline: bigint;
}

export interface IntentExecutionRouteInput {
  tokenIn: Address;
  tokenOut: Address;
  quoteAmountOut: bigint;
  minAmountOut: bigint;
  adapter: Address;
  adapterData?: Hex;
  adapterDataHash?: Hex;
}

export interface CanonicalClaimRecord {
  payload: ClaimPayload;
  epochId: bigint;
  claimHash: Hex;
}

export interface CanonicalIntentRecord {
  intent: TradeIntent;
  intentHash: Hex;
  constraints: IntentConstraints;
}
