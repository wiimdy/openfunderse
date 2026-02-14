import { createPublicClient, getAddress, http, isAddress, parseAbi } from 'viem';

export interface ProposeIntentInput {
  taskType: 'propose_intent';
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
  status: 'OK';
  taskType: 'propose_intent';
  fundId: string;
  epochId: number;
  decision: 'PROPOSE';
  intent: {
    intentVersion: string;
    fundId: string;
    roomId: string;
    epochId: number;
    vault: string;
    action: 'BUY' | 'SELL';
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
  status: 'OK';
  taskType: 'propose_intent';
  fundId: string;
  roomId: string;
  epochId: number;
  decision: 'HOLD';
  reason: string;
  confidence: number;
  assumptions: string[];
}

export type ProposeIntentOutput = ProposeDecision | HoldDecision;

interface NadfunNetworkConfig {
  chainId: number;
  bondingRouter: `0x${string}`;
  dexRouter: `0x${string}`;
  lens: `0x${string}`;
  wmon: `0x${string}`;
}

const NADFUN_NETWORKS: Record<number, NadfunNetworkConfig> = {
  10143: {
    chainId: 10143,
    bondingRouter: '0x865054F0F6A288adaAc30261731361EA7E908003',
    dexRouter: '0x5D4a4f430cA3B1b2dB86B9cFE48a5316800F5fb2',
    lens: '0xB056d79CA5257589692699a46623F901a3BB76f1',
    wmon: '0x5a4E0bFDeF88C9032CB4d24338C5EB3d3870BfDd'
  },
  143: {
    chainId: 143,
    bondingRouter: '0x6F6B8F1a20703309951a5127c45B49b1CD981A22',
    dexRouter: '0x0B79d71AE99528D1dB24A4148b5f4F865cc2b137',
    lens: '0x7e78A8DE94f21804F7a17F4E8BF9EC2c872187ea',
    wmon: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A'
  }
};

const LENS_ABI = parseAbi([
  'function getAmountOut(address token, uint256 amountIn, bool isBuy) view returns (address router, uint256 amountOut)'
]);

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const nowSeconds = (): number => {
  return Math.floor(Date.now() / 1000);
};

const holdDecision = (
  input: ProposeIntentInput,
  reason: string,
  assumptions: string[] = []
): HoldDecision => {
  return {
    status: 'OK',
    taskType: 'propose_intent',
    fundId: input.fundId,
    roomId: input.roomId,
    epochId: input.epochId,
    decision: 'HOLD',
    reason,
    confidence: 0.95,
    assumptions
  };
};

const normalizedAddressSet = (
  values: string[]
): Set<string> => {
  const set = new Set<string>();
  for (const value of values) {
    if (isAddress(value)) {
      set.add(getAddress(value).toLowerCase());
    }
  }
  return set;
};

const parsePositiveBigInt = (value: string): bigint | null => {
  try {
    const parsed = BigInt(value);
    if (parsed <= 0n) return null;
    return parsed;
  } catch {
    return null;
  }
};

const usesNadfunVenue = (venues: string[]): boolean => {
  if (venues.length === 0) return true;
  return venues.some((venue) => venue.trim().toLowerCase() === 'nadfun');
};

export async function proposeIntent(input: ProposeIntentInput): Promise<ProposeIntentOutput> {
  const { fundId, roomId, epochId, snapshot, riskPolicy } = input;

  if (!snapshot.finalized) {
    return holdDecision(input, 'snapshot not finalized');
  }
  if (snapshot.claimCount < 1) {
    return holdDecision(input, 'no claims in snapshot');
  }

  const amountIn = parsePositiveBigInt(riskPolicy.maxNotional);
  const riskChecks: RiskChecks = {
    allowlistPass: riskPolicy.allowlistTokens.length > 0 && usesNadfunVenue(riskPolicy.allowlistVenues),
    notionalPass: amountIn !== null,
    slippagePass: riskPolicy.maxSlippageBps > 0 && riskPolicy.maxSlippageBps <= 10_000,
    deadlinePass: true
  };
  if (!riskChecks.allowlistPass || !riskChecks.notionalPass || !riskChecks.slippagePass) {
    return holdDecision(input, 'risk policy check failed', [
      'allowlistTokens must include at least one token',
      'allowlistVenues must include NadFun when venues are specified',
      'maxNotional must be a positive integer',
      'maxSlippageBps must be between 1 and 10000'
    ]);
  }

  const network = NADFUN_NETWORKS[input.marketState.network];
  if (!network) {
    return holdDecision(input, `unsupported NadFun network: ${input.marketState.network}`);
  }
  const rpcUrl = process.env.RPC_URL;
  if (!rpcUrl) {
    return holdDecision(input, 'RPC_URL is required for NadFun quote');
  }

  const tokenOutRaw = riskPolicy.allowlistTokens[0] ?? '';
  if (!isAddress(tokenOutRaw)) {
    return holdDecision(input, `invalid allowlist token address: ${tokenOutRaw}`);
  }
  const tokenOut = getAddress(tokenOutRaw);

  const lensAddress = (process.env.NADFUN_LENS_ADDRESS && isAddress(process.env.NADFUN_LENS_ADDRESS))
    ? getAddress(process.env.NADFUN_LENS_ADDRESS)
    : network.lens;
  const tokenIn = (process.env.NADFUN_WMON_ADDRESS && isAddress(process.env.NADFUN_WMON_ADDRESS))
    ? getAddress(process.env.NADFUN_WMON_ADDRESS)
    : network.wmon;
  const allowedRouters = normalizedAddressSet([
    process.env.NADFUN_BONDING_CURVE_ROUTER ?? network.bondingRouter,
    process.env.NADFUN_DEX_ROUTER ?? network.dexRouter
  ]);

  const client = createPublicClient({
    transport: http(rpcUrl)
  });

  let quotedRouter: `0x${string}`;
  let quoteAmountOut: bigint;
  try {
    const quote = await client.readContract({
      address: lensAddress as `0x${string}`,
      abi: LENS_ABI,
      functionName: 'getAmountOut',
      args: [tokenOut as `0x${string}`, amountIn as bigint, true]
    });
    quotedRouter = getAddress(quote[0]) as `0x${string}`;
    quoteAmountOut = quote[1];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return holdDecision(input, `NadFun quote call failed: ${message}`);
  }

  if (!allowedRouters.has(quotedRouter.toLowerCase())) {
    return holdDecision(input, 'router mismatch: lens returned unsupported router', [
      `quotedRouter=${quotedRouter}`
    ]);
  }
  if (quoteAmountOut <= 0n) {
    return holdDecision(input, 'quote amountOut is zero');
  }

  const minAmountOut =
    (quoteAmountOut * BigInt(10_000 - riskPolicy.maxSlippageBps)) /
    10_000n;
  if (minAmountOut <= 0n) {
    return holdDecision(input, 'computed minAmountOut is zero');
  }

  const deadline = nowSeconds() + 300;
  return {
    status: 'OK',
    taskType: 'propose_intent',
    fundId,
    epochId,
    decision: 'PROPOSE',
    intent: {
      intentVersion: 'V1',
      fundId,
      roomId,
      epochId,
      vault: process.env.VAULT_ADDRESS ?? ZERO_ADDRESS,
      action: 'BUY',
      tokenIn,
      tokenOut,
      amountIn: String(amountIn),
      minAmountOut: String(minAmountOut),
      deadline,
      maxSlippageBps: riskPolicy.maxSlippageBps,
      snapshotHash: snapshot.snapshotHash
    },
    reason: `NadFun quote validated via lens (${quotedRouter})`,
    riskChecks,
    confidence: 0.9,
    assumptions: [
      'execution route must use the same router returned by NadFun lens',
      'quote is for BUY flow (WMON -> token)'
    ]
  };
}
