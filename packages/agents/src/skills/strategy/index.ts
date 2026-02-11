export interface ProposeIntentInput {
  taskType: "propose_intent";
  fundId: string;
  roomId: string;
  epochId: number;
  snapshot: {
    snapshotHash: string;
    finalized: boolean;
    claimCount: number;
  };
  marketState: {
    network: number;
    nadfunCurveState: Record<string, unknown>;
    liquidity: Record<string, unknown>;
    volatility: Record<string, unknown>;
  };
  riskPolicy: {
    maxNotional: string;
    maxSlippageBps: number;
    allowlistTokens: string[];
    allowlistVenues: string[];
  };
}

export interface RiskChecks {
  allowlistPass: boolean;
  notionalPass: boolean;
  slippagePass: boolean;
  deadlinePass: boolean;
}

export interface ProposeDecision {
  status: "OK";
  taskType: "propose_intent";
  fundId: string;
  epochId: number;
  decision: "PROPOSE";
  intent: {
    intentVersion: string;
    fundId: string;
    roomId: string;
    epochId: number;
    vault: string;
    action: "BUY" | "SELL";
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    minAmountOut: string;
    deadline: number;
    maxSlippageBps: number;
    snapshotHash: string;
  };
  reason: string;
  riskChecks: RiskChecks;
  confidence: number;
  assumptions: string[];
}

export interface HoldDecision {
  status: "OK";
  taskType: "propose_intent";
  fundId: string;
  roomId: string;
  epochId: number;
  decision: "HOLD";
  reason: string;
  confidence: number;
  assumptions: string[];
}

export type ProposeIntentOutput = ProposeDecision | HoldDecision;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export async function proposeIntent(input: ProposeIntentInput): Promise<ProposeIntentOutput> {
  const { fundId, roomId, epochId, snapshot, riskPolicy } = input;

  if (!snapshot.finalized) {
    return {
      status: "OK",
      taskType: "propose_intent",
      fundId,
      roomId,
      epochId,
      decision: "HOLD",
      reason: "snapshot not finalized",
      confidence: 1,
      assumptions: [],
    };
  }

  if (snapshot.claimCount < 1) {
    return {
      status: "OK",
      taskType: "propose_intent",
      fundId,
      roomId,
      epochId,
      decision: "HOLD",
      reason: "no claims in snapshot",
      confidence: 1,
      assumptions: [],
    };
  }

  const riskChecks: RiskChecks = {
    allowlistPass: riskPolicy.allowlistTokens.length > 0,
    notionalPass: BigInt(riskPolicy.maxNotional) > BigInt(0),
    slippagePass: riskPolicy.maxSlippageBps > 0 && riskPolicy.maxSlippageBps <= 10000,
    deadlinePass: true,
  };

  const anyRiskFail = !riskChecks.allowlistPass || !riskChecks.notionalPass || !riskChecks.slippagePass || !riskChecks.deadlinePass;

  if (anyRiskFail) {
    return {
      status: "OK",
      taskType: "propose_intent",
      fundId,
      roomId,
      epochId,
      decision: "HOLD",
      reason: "risk policy check failed",
      confidence: 0.9,
      assumptions: ["risk checks are scaffold defaults"],
    };
  }

  const tokenIn = riskPolicy.allowlistTokens[0] ?? "0x0000000000000000000000000000000000000000";
  const tokenOut = riskPolicy.allowlistTokens[1] ?? "0x0000000000000000000000000000000000000000";
  const deadline = nowSeconds() + 3600;

  return {
    status: "OK",
    taskType: "propose_intent",
    fundId,
    epochId,
    decision: "PROPOSE",
    intent: {
      intentVersion: "V1",
      fundId,
      roomId,
      epochId,
      vault: "0x0000000000000000000000000000000000000000",
      action: "BUY",
      tokenIn,
      tokenOut,
      amountIn: riskPolicy.maxNotional,
      minAmountOut: "0",
      deadline,
      maxSlippageBps: riskPolicy.maxSlippageBps,
      snapshotHash: snapshot.snapshotHash,
    },
    reason: "scaffold proposal — actual strategy logic is delegated to LLM agent at runtime",
    riskChecks,
    confidence: 0.5,
    assumptions: [
      "vault address is placeholder",
      "token selection is placeholder (first two from allowlist)",
      "minAmountOut set to 0 — production must compute from market data",
    ],
  };
}
