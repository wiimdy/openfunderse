import {
  buildCanonicalIntentRecord,
  buildIntentAllowlistHashFromRoute,
  encodeNadfunExecutionDataV1,
  type ExecutionVenue,
  type IntentExecutionRouteInput,
  type TradeIntent
} from '@claw/protocol-sdk';
import {
  RelayerHttpError,
  createRelayerClient,
  type RelayerProposeIntentInput
} from '../../lib/relayer-client.js';
import {
  createWalletClient,
  createPublicClient,
  defineChain,
  getAddress,
  http,
  isAddress,
  parseAbi,
  type Address,
  type Hex
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

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
    positions?: StrategyTokenPositionInput[];
  };
  riskPolicy: {
    maxNotional: string;
    maxSlippageBps: number;
    allowlistTokens: string[];
    allowlistVenues: string[];
  };
}

export interface StrategyTokenPositionInput {
  token: string;
  quantity: string | number | bigint;
  costBasisAsset?: string | number | bigint;
  openedAt?: string | number | bigint;
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
  executionPlan: {
    venue: ExecutionVenue;
    router: string;
    quoteAmountOut: string;
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

export interface ProposeIntentAndSubmitInput extends ProposeIntentInput {
  intentURI?: string;
  intentBookAddress?: string;
  strategySignerAddress?: string;
  adapterAddress?: string;
  allowExistingOnchainIntent?: boolean;
  submit?: boolean;
}

export interface ProposeIntentAndSubmitOutput {
  status: 'OK';
  taskType: 'propose_intent';
  fundId: string;
  decision: 'HOLD' | 'READY' | 'SUBMITTED';
  proposal: ProposeIntentOutput;
  intentHash?: string;
  executionRoute?: {
    tokenIn: string;
    tokenOut: string;
    quoteAmountOut: string;
    minAmountOut: string;
    adapter: string;
    adapterData: string;
    allowlistHash: string;
  };
  relayer?: {
    submitted: boolean;
    duplicate: boolean;
    response?: Record<string, unknown>;
  };
  onchain?: {
    submitted: boolean;
    skippedExisting: boolean;
    txHash?: string;
  };
  safety?: {
    submitRequested: boolean;
    autoSubmitEnabled: boolean;
    requireExplicitSubmit: boolean;
    trustedRelayerHosts: string[];
  };
}

interface NadfunNetworkConfig {
  chainId: number;
  bondingRouter: `0x${string}`;
  dexRouter: `0x${string}`;
  lens: `0x${string}`;
  wmon: `0x${string}`;
}

interface BuyCandidate {
  token: `0x${string}`;
  router: `0x${string}`;
  amountIn: bigint;
  quoteAmountOut: bigint;
  minAmountOut: bigint;
  impactBps: number;
  score: number;
}

interface PositionState {
  quantity: bigint;
  costBasisAsset: bigint | null;
  openedAt: number | null;
}

type SellTrigger = 'TAKE_PROFIT' | 'STOP_LOSS' | 'TIME_EXIT';

interface SellCandidate {
  token: `0x${string}`;
  router: `0x${string}`;
  amountIn: bigint;
  quoteAmountOut: bigint;
  minAmountOut: bigint;
  pnlBps: number | null;
  ageSeconds: number | null;
  trigger: SellTrigger;
  urgency: number;
}

type IntentExecutionDataTuple = readonly [
  exists: boolean,
  approved: boolean,
  snapshotHash: Hex,
  deadline: bigint,
  maxSlippageBps: number,
  maxNotional: bigint,
  allowlistHash: Hex
];

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

const INTENT_BOOK_SUBMISSION_ABI = parseAbi([
  'function proposeIntent(bytes32 intentHash, string intentURI, bytes32 snapshotHash, (bytes32 allowlistHash, uint16 maxSlippageBps, uint256 maxNotional, uint64 deadline) constraints)',
  'function getIntentExecutionData(bytes32 intentHash) view returns (bool exists, bool approved, bytes32 snapshotHash, uint64 deadline, uint16 maxSlippageBps, uint256 maxNotional, bytes32 allowlistHash)'
]);

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const DEFAULT_MIN_DEADLINE_SECONDS = 600;
const DEFAULT_BASE_DEADLINE_SECONDS = 900;
const DEFAULT_MAX_DEADLINE_SECONDS = 3600;
const DEFAULT_PER_CLAIM_DEADLINE_SECONDS = 20;
const DEFAULT_MAX_IMPACT_BPS = 60;
const DEFAULT_SELL_TAKE_PROFIT_BPS = 2000;
const DEFAULT_SELL_STOP_LOSS_BPS = 600;
const DEFAULT_SELL_MAX_HOLD_SECONDS = 5400;
const DEFAULT_REQUIRE_EXPLICIT_SUBMIT = true;
const DEFAULT_AUTO_SUBMIT = false;

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^::1$/,
  /^\[::1\]$/,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./
];

const nowSeconds = (): number => {
  return Math.floor(Date.now() / 1000);
};

const clampInt = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value));
};

const envPositiveInt = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;

  return Math.floor(parsed);
};

const envBool = (name: string, fallback: boolean): boolean => {
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const envCsv = (name: string): string[] => {
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) return [];
  return raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
};

const isPrivateHost = (host: string): boolean => {
  const normalized = host.trim().toLowerCase();
  if (normalized.endsWith('.local')) return true;
  return PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(normalized));
};

const validateStrategyRelayerUrl = (rawUrl: string, trustedHosts: string[]): void => {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`RELAYER_URL is invalid: ${rawUrl}`);
  }

  const host = parsed.hostname.trim().toLowerCase();
  const allowHttp = envBool('STRATEGY_ALLOW_HTTP_RELAYER', false);
  if (parsed.protocol !== 'https:' && !(allowHttp && parsed.protocol === 'http:')) {
    throw new Error(
      'RELAYER_URL must use https (set STRATEGY_ALLOW_HTTP_RELAYER=true only for local development)'
    );
  }

  if (trustedHosts.length > 0 && !trustedHosts.includes(host)) {
    throw new Error(
      `RELAYER_URL host is not in STRATEGY_TRUSTED_RELAYER_HOSTS: host=${host}`
    );
  }

  if (trustedHosts.length === 0 && isPrivateHost(host) && parsed.protocol === 'https:') {
    throw new Error(
      'RELAYER_URL points to a private/local host over https. Configure STRATEGY_TRUSTED_RELAYER_HOSTS explicitly.'
    );
  }
};

const computeDeadlineTtlSeconds = (claimCount: number): number => {
  const minTtl = envPositiveInt(
    'STRATEGY_DEADLINE_MIN_SECONDS',
    DEFAULT_MIN_DEADLINE_SECONDS
  );
  const baseTtl = envPositiveInt(
    'STRATEGY_DEADLINE_BASE_SECONDS',
    DEFAULT_BASE_DEADLINE_SECONDS
  );
  const maxTtl = envPositiveInt(
    'STRATEGY_DEADLINE_MAX_SECONDS',
    DEFAULT_MAX_DEADLINE_SECONDS
  );
  const perClaim = envPositiveInt(
    'STRATEGY_DEADLINE_PER_CLAIM_SECONDS',
    DEFAULT_PER_CLAIM_DEADLINE_SECONDS
  );

  const rawTtl = baseTtl + Math.max(claimCount, 0) * perClaim;
  return clampInt(rawTtl, minTtl, Math.max(minTtl, maxTtl));
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

const asObject = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const normalizedAddressSet = (values: string[]): Set<string> => {
  const set = new Set<string>();
  for (const value of values) {
    if (isAddress(value)) {
      set.add(getAddress(value).toLowerCase());
    }
  }
  return set;
};

const normalizedAddressList = (values: string[]): `0x${string}`[] => {
  const result: `0x${string}`[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (!isAddress(value)) continue;
    const normalized = getAddress(value) as `0x${string}`;
    const lowered = normalized.toLowerCase();
    if (seen.has(lowered)) continue;
    seen.add(lowered);
    result.push(normalized);
  }

  return result;
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

const requireAddress = (value: string | undefined, label: string): Address => {
  if (!value || !isAddress(value)) {
    throw new Error(`${label} must be a valid address`);
  }
  return getAddress(value) as Address;
};

const requirePositiveBigInt = (value: string, label: string): bigint => {
  const parsed = parsePositiveBigInt(value);
  if (!parsed) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
};

const uint16FromBigInt = (value: bigint, label: string): number => {
  if (value < 0n || value > 65_535n) {
    throw new Error(`${label} must be between 0 and 65535`);
  }
  return Number(value);
};

const requireStrategyPrivateKey = (): Hex => {
  const raw = process.env.STRATEGY_PRIVATE_KEY ?? '';
  if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error('STRATEGY_PRIVATE_KEY is required and must be a 32-byte hex private key');
  }
  return raw as Hex;
};

const strategyRuntime = (): {
  chainId: number;
  rpcUrl: string;
  chain: ReturnType<typeof defineChain>;
} => {
  const chainIdRaw = Number(process.env.CHAIN_ID ?? '10143');
  if (!Number.isFinite(chainIdRaw) || chainIdRaw <= 0) {
    throw new Error('CHAIN_ID must be a positive number');
  }
  const rpcUrl = process.env.RPC_URL ?? '';
  if (!rpcUrl) {
    throw new Error('RPC_URL is required');
  }

  const chainId = Math.trunc(chainIdRaw);
  const chain = defineChain({
    id: chainId,
    name: `strategy-signer-${chainId}`,
    nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
    rpcUrls: {
      default: { http: [rpcUrl] },
      public: { http: [rpcUrl] }
    }
  });

  return { chainId, rpcUrl, chain };
};

const resolveNadfunVenue = (
  router: `0x${string}`,
  bondingRouter: `0x${string}`,
  dexRouter: `0x${string}`
): ExecutionVenue | null => {
  if (router.toLowerCase() === bondingRouter.toLowerCase()) {
    return 'NADFUN_BONDING_CURVE';
  }
  if (router.toLowerCase() === dexRouter.toLowerCase()) {
    return 'NADFUN_DEX';
  }
  return null;
};

const parseBigIntValue = (value: unknown): bigint | null => {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) return null;
    return BigInt(value);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    try {
      return BigInt(value.trim());
    } catch {
      return null;
    }
  }
  return null;
};

const parseTimestamp = (value: unknown): number | null => {
  const normalize = (raw: number): number => {
    // Heuristic: timestamps >= 1e12 are treated as milliseconds.
    if (raw >= 1_000_000_000_000) {
      return Math.floor(raw / 1000);
    }
    return Math.floor(raw);
  };

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    const normalized = normalize(value);
    return normalized > 0 ? normalized : null;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value.trim());
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    const normalized = normalize(parsed);
    return normalized > 0 ? normalized : null;
  }
  if (typeof value === 'bigint') {
    if (value <= 0n) return null;
    const asNumber = Number(value);
    if (!Number.isFinite(asNumber) || asNumber <= 0) return null;
    const normalized = normalize(asNumber);
    return normalized > 0 ? normalized : null;
  }
  return null;
};

const usesNadfunVenue = (venues: string[]): boolean => {
  if (venues.length === 0) return true;
  return venues.some((venue) => venue.trim().toLowerCase() === 'nadfun');
};

const isNonNull = <T>(value: T | null): value is T => value !== null;

const readBigIntField = (
  source: Record<string, unknown>,
  keys: string[],
  positiveOnly: boolean
): bigint | null => {
  for (const key of keys) {
    const raw = source[key];
    const parsed = parseBigIntValue(raw);
    if (parsed === null) continue;
    if (positiveOnly && parsed <= 0n) continue;
    if (!positiveOnly && parsed < 0n) continue;
    return parsed;
  }
  return null;
};

const readTimestampField = (
  source: Record<string, unknown>,
  keys: string[]
): number | null => {
  for (const key of keys) {
    const parsed = parseTimestamp(source[key]);
    if (parsed !== null) return parsed;
  }
  return null;
};

const parsePositionNode = (value: unknown): PositionState | null => {
  const obj = asObject(value);
  if (!obj) return null;

  const quantity = readBigIntField(
    obj,
    ['quantity', 'balance', 'amount', 'tokenAmount', 'tokenBalance'],
    true
  );
  if (!quantity) return null;

  const costBasis = readBigIntField(
    obj,
    ['costBasisAsset', 'costBasis', 'cost', 'entryNotional', 'notional'],
    false
  );
  const openedAt = readTimestampField(obj, [
    'openedAt',
    'enteredAt',
    'entryTimestamp',
    'lastBuyAt',
    'createdAt'
  ]);

  return {
    quantity,
    costBasisAsset: costBasis && costBasis > 0n ? costBasis : null,
    openedAt
  };
};

const tokenFromNode = (value: unknown): string | null => {
  const obj = asObject(value);
  if (!obj) return null;

  const rawToken =
    obj.token ?? obj.tokenAddress ?? obj.asset ?? obj.assetAddress ?? obj.address;
  if (typeof rawToken !== 'string' || !isAddress(rawToken)) return null;
  return getAddress(rawToken).toLowerCase();
};

const matchPositionInCollection = (
  collection: unknown,
  tokenLower: string
): PositionState | null => {
  const obj = asObject(collection);
  if (obj) {
    for (const [key, value] of Object.entries(obj)) {
      if (isAddress(key) && getAddress(key).toLowerCase() === tokenLower) {
        const parsed = parsePositionNode(value);
        if (parsed) return parsed;
      }

      const nodeToken = tokenFromNode(value);
      if (nodeToken === tokenLower) {
        const direct = parsePositionNode(value);
        if (direct) return direct;

        const nestedObj = asObject(value);
        if (nestedObj) {
          const nested =
            parsePositionNode(nestedObj.position) ??
            parsePositionNode(nestedObj.state) ??
            parsePositionNode(nestedObj.value);
          if (nested) return nested;
        }
      }
    }
  }

  if (!Array.isArray(collection)) return null;

  for (const item of collection) {
    const nodeToken = tokenFromNode(item);
    if (nodeToken !== tokenLower) continue;

    const direct = parsePositionNode(item);
    if (direct) return direct;

    const itemObj = asObject(item);
    if (!itemObj) continue;

    const nested =
      parsePositionNode(itemObj.position) ??
      parsePositionNode(itemObj.state) ??
      parsePositionNode(itemObj.value);
    if (nested) return nested;
  }

  return null;
};

const extractTokenPosition = (
  marketState: ProposeIntentInput['marketState'],
  token: `0x${string}`
): PositionState | null => {
  const tokenLower = token.toLowerCase();

  if (Array.isArray(marketState.positions)) {
    for (const raw of marketState.positions) {
      if (!raw || typeof raw !== 'object') continue;
      if (!isAddress(raw.token) || getAddress(raw.token).toLowerCase() !== tokenLower) continue;

      const quantity = parseBigIntValue(raw.quantity);
      if (!quantity || quantity <= 0n) continue;

      const costBasisRaw =
        raw.costBasisAsset === undefined ? null : parseBigIntValue(raw.costBasisAsset);
      const openedAt = parseTimestamp(raw.openedAt);

      return {
        quantity,
        costBasisAsset: costBasisRaw && costBasisRaw > 0n ? costBasisRaw : null,
        openedAt
      };
    }
  }

  const sources: unknown[] = [
    marketState.nadfunCurveState,
    marketState.liquidity,
    marketState.volatility
  ];

  for (const source of sources) {
    const direct = matchPositionInCollection(source, tokenLower);
    if (direct) return direct;

    const sourceObj = asObject(source);
    if (!sourceObj) continue;

    const nestedKeys = [
      'positions',
      'tokenPositions',
      'holdings',
      'inventory',
      'balances',
      'openPositions'
    ];

    for (const key of nestedKeys) {
      const matched = matchPositionInCollection(sourceObj[key], tokenLower);
      if (matched) return matched;
    }
  }

  return null;
};

const computeImpactBps = (quoteA: bigint, quote2A: bigint): number => {
  if (quoteA <= 0n) return 10_000;
  const linear = quoteA * 2n;
  if (quote2A >= linear) return 0;

  const impact = ((linear - quote2A) * 10_000n) / linear;
  return Number(impact > 10_000n ? 10_000n : impact);
};

const scaledAmountByImpact = (
  amountIn: bigint,
  impactBps: number,
  maxImpactBps: number
): bigint => {
  if (impactBps <= maxImpactBps || impactBps <= 0) return amountIn;

  const scaled =
    (amountIn * BigInt(maxImpactBps)) / BigInt(Math.max(impactBps, 1));
  if (scaled <= 0n) return 1n;
  return scaled;
};

const applySlippage = (amountOut: bigint, maxSlippageBps: number): bigint => {
  return (amountOut * BigInt(10_000 - maxSlippageBps)) / 10_000n;
};

const quoteFromLens = async (input: {
  client: ReturnType<typeof createPublicClient>;
  lensAddress: `0x${string}`;
  token: `0x${string}`;
  amountIn: bigint;
  isBuy: boolean;
}): Promise<{ router: `0x${string}`; amountOut: bigint } | null> => {
  try {
    const quote = await input.client.readContract({
      address: input.lensAddress,
      abi: LENS_ABI,
      functionName: 'getAmountOut',
      args: [input.token, input.amountIn, input.isBuy]
    });

    return {
      router: getAddress(quote[0]) as `0x${string}`,
      amountOut: quote[1]
    };
  } catch {
    return null;
  }
};

const evaluateBuyCandidate = async (input: {
  client: ReturnType<typeof createPublicClient>;
  lensAddress: `0x${string}`;
  token: `0x${string}`;
  maxAmountIn: bigint;
  maxImpactBps: number;
  maxSlippageBps: number;
  allowedRouters: Set<string>;
}): Promise<BuyCandidate | null> => {
  const first = await quoteFromLens({
    client: input.client,
    lensAddress: input.lensAddress,
    token: input.token,
    amountIn: input.maxAmountIn,
    isBuy: true
  });
  if (!first || first.amountOut <= 0n) return null;

  const doubled = await quoteFromLens({
    client: input.client,
    lensAddress: input.lensAddress,
    token: input.token,
    amountIn: input.maxAmountIn * 2n,
    isBuy: true
  });
  if (!doubled || doubled.amountOut <= 0n) return null;

  const impactBps = computeImpactBps(first.amountOut, doubled.amountOut);
  const adjustedAmountIn = scaledAmountByImpact(
    input.maxAmountIn,
    impactBps,
    input.maxImpactBps
  );

  let finalQuote = first;
  if (adjustedAmountIn !== input.maxAmountIn) {
    const requote = await quoteFromLens({
      client: input.client,
      lensAddress: input.lensAddress,
      token: input.token,
      amountIn: adjustedAmountIn,
      isBuy: true
    });
    if (!requote || requote.amountOut <= 0n) return null;
    finalQuote = requote;
  }

  if (!input.allowedRouters.has(finalQuote.router.toLowerCase())) {
    return null;
  }

  const minAmountOut = applySlippage(finalQuote.amountOut, input.maxSlippageBps);
  if (minAmountOut <= 0n) return null;

  return {
    token: input.token,
    router: finalQuote.router,
    amountIn: adjustedAmountIn,
    quoteAmountOut: finalQuote.amountOut,
    minAmountOut,
    impactBps,
    score: 10_000 - impactBps
  };
};

const evaluateSellCandidate = async (input: {
  client: ReturnType<typeof createPublicClient>;
  lensAddress: `0x${string}`;
  token: `0x${string}`;
  position: PositionState;
  maxAmountIn: bigint;
  maxSlippageBps: number;
  takeProfitBps: number;
  stopLossBps: number;
  maxHoldSeconds: number;
  allowedRouters: Set<string>;
  nowTs: number;
}): Promise<SellCandidate | null> => {
  const amountIn =
    input.position.quantity <= input.maxAmountIn
      ? input.position.quantity
      : input.maxAmountIn;
  if (amountIn <= 0n) return null;

  const quote = await quoteFromLens({
    client: input.client,
    lensAddress: input.lensAddress,
    token: input.token,
    amountIn,
    isBuy: false
  });
  if (!quote || quote.amountOut <= 0n) return null;
  if (!input.allowedRouters.has(quote.router.toLowerCase())) return null;

  const minAmountOut = applySlippage(quote.amountOut, input.maxSlippageBps);
  if (minAmountOut <= 0n) return null;

  let pnlBps: number | null = null;
  if (
    input.position.costBasisAsset &&
    input.position.costBasisAsset > 0n &&
    input.position.quantity > 0n
  ) {
    const costPortion =
      (input.position.costBasisAsset * amountIn) / input.position.quantity;
    if (costPortion > 0n) {
      pnlBps = Number(((quote.amountOut - costPortion) * 10_000n) / costPortion);
    }
  }

  const ageSeconds =
    input.position.openedAt && input.position.openedAt > 0
      ? Math.max(0, input.nowTs - input.position.openedAt)
      : null;

  let trigger: SellTrigger | null = null;
  let urgency = 0;

  if (pnlBps !== null && pnlBps >= input.takeProfitBps) {
    trigger = 'TAKE_PROFIT';
    urgency = pnlBps - input.takeProfitBps;
  } else if (pnlBps !== null && pnlBps <= -input.stopLossBps) {
    trigger = 'STOP_LOSS';
    urgency = Math.abs(pnlBps) - input.stopLossBps;
  } else if (ageSeconds !== null && ageSeconds >= input.maxHoldSeconds) {
    trigger = 'TIME_EXIT';
    urgency = ageSeconds - input.maxHoldSeconds;
  }

  if (!trigger) return null;

  return {
    token: input.token,
    router: quote.router,
    amountIn,
    quoteAmountOut: quote.amountOut,
    minAmountOut,
    pnlBps,
    ageSeconds,
    trigger,
    urgency
  };
};

export async function proposeIntent(input: ProposeIntentInput): Promise<ProposeIntentOutput> {
  const { fundId, roomId, epochId, snapshot, riskPolicy } = input;

  if (!snapshot.finalized) {
    return holdDecision(input, 'snapshot not finalized');
  }
  if (snapshot.claimCount < 1) {
    return holdDecision(input, 'no claims in snapshot');
  }

  const maxAmountIn = parsePositiveBigInt(riskPolicy.maxNotional);
  const candidateTokens = normalizedAddressList(riskPolicy.allowlistTokens);
  const deadlineTtlSeconds = computeDeadlineTtlSeconds(snapshot.claimCount);

  const riskChecks: RiskChecks = {
    allowlistPass: candidateTokens.length > 0 && usesNadfunVenue(riskPolicy.allowlistVenues),
    notionalPass: maxAmountIn !== null,
    slippagePass: riskPolicy.maxSlippageBps > 0 && riskPolicy.maxSlippageBps <= 10_000,
    deadlinePass: deadlineTtlSeconds >= 300
  };

  if (!riskChecks.allowlistPass || !riskChecks.notionalPass || !riskChecks.slippagePass || !riskChecks.deadlinePass) {
    return holdDecision(input, 'risk policy check failed', [
      'allowlistTokens must include at least one valid token address',
      'allowlistVenues must include NadFun when venues are specified',
      'maxNotional must be a positive integer',
      'maxSlippageBps must be between 1 and 10000',
      'deadline TTL must be at least 300 seconds'
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

  const lensAddress = (process.env.NADFUN_LENS_ADDRESS && isAddress(process.env.NADFUN_LENS_ADDRESS))
    ? getAddress(process.env.NADFUN_LENS_ADDRESS)
    : network.lens;
  const wmon = (process.env.NADFUN_WMON_ADDRESS && isAddress(process.env.NADFUN_WMON_ADDRESS))
    ? getAddress(process.env.NADFUN_WMON_ADDRESS)
    : network.wmon;
  const bondingRouter = (process.env.NADFUN_BONDING_CURVE_ROUTER &&
    isAddress(process.env.NADFUN_BONDING_CURVE_ROUTER))
    ? getAddress(process.env.NADFUN_BONDING_CURVE_ROUTER)
    : network.bondingRouter;
  const dexRouter = (process.env.NADFUN_DEX_ROUTER &&
    isAddress(process.env.NADFUN_DEX_ROUTER))
    ? getAddress(process.env.NADFUN_DEX_ROUTER)
    : network.dexRouter;

  const allowedRouters = normalizedAddressSet([
    bondingRouter,
    dexRouter
  ]);

  if (allowedRouters.size === 0) {
    return holdDecision(input, 'no allowed NadFun routers configured');
  }

  const client = createPublicClient({
    transport: http(rpcUrl)
  });

  const nowTs = nowSeconds();
  const deadline = nowTs + deadlineTtlSeconds;
  const maxImpactBps = envPositiveInt('STRATEGY_MAX_IMPACT_BPS', DEFAULT_MAX_IMPACT_BPS);

  const takeProfitBps = envPositiveInt(
    'STRATEGY_SELL_TAKE_PROFIT_BPS',
    DEFAULT_SELL_TAKE_PROFIT_BPS
  );
  const stopLossBps = envPositiveInt(
    'STRATEGY_SELL_STOP_LOSS_BPS',
    DEFAULT_SELL_STOP_LOSS_BPS
  );
  const maxHoldSeconds = envPositiveInt(
    'STRATEGY_SELL_MAX_HOLD_SECONDS',
    DEFAULT_SELL_MAX_HOLD_SECONDS
  );

  const sellCandidates = (
    await Promise.all(
      candidateTokens.map(async (token) => {
        const position = extractTokenPosition(input.marketState, token);
        if (!position || position.quantity <= 0n) return null;

        return evaluateSellCandidate({
          client,
          lensAddress: lensAddress as `0x${string}`,
          token,
          position,
          maxAmountIn: maxAmountIn as bigint,
          maxSlippageBps: riskPolicy.maxSlippageBps,
          takeProfitBps,
          stopLossBps,
          maxHoldSeconds,
          allowedRouters,
          nowTs
        });
      })
    )
  ).filter(isNonNull);

  sellCandidates.sort((a, b) => {
    if (a.trigger !== b.trigger) {
      if (a.trigger === 'STOP_LOSS') return -1;
      if (b.trigger === 'STOP_LOSS') return 1;
      if (a.trigger === 'TIME_EXIT') return -1;
      if (b.trigger === 'TIME_EXIT') return 1;
    }

    if (b.urgency !== a.urgency) return b.urgency - a.urgency;
    if (b.quoteAmountOut === a.quoteAmountOut) return 0;
    return b.quoteAmountOut > a.quoteAmountOut ? 1 : -1;
  });

  const sellPick = sellCandidates[0];
  if (sellPick) {
    const venue = resolveNadfunVenue(sellPick.router, bondingRouter, dexRouter);
    if (!venue) {
      return holdDecision(input, `unsupported NadFun router for SELL: ${sellPick.router}`);
    }

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
        action: 'SELL',
        tokenIn: sellPick.token,
        tokenOut: wmon,
        amountIn: String(sellPick.amountIn),
        minAmountOut: String(sellPick.minAmountOut),
        deadline,
        maxSlippageBps: riskPolicy.maxSlippageBps,
        snapshotHash: snapshot.snapshotHash
      },
      executionPlan: {
        venue,
        router: sellPick.router,
        quoteAmountOut: sellPick.quoteAmountOut.toString()
      },
      reason: `NadFun SELL trigger=${sellPick.trigger} token=${sellPick.token} router=${sellPick.router}`,
      riskChecks,
      confidence: 0.9,
      assumptions: [
        'sell path prioritizes capital protection and position recycling',
        `pnlBps=${sellPick.pnlBps ?? 'n/a'} ageSeconds=${sellPick.ageSeconds ?? 'n/a'}`,
        'execution route must use the same router returned by NadFun lens'
      ]
    };
  }

  const buyCandidates = (
    await Promise.all(
      candidateTokens.map((token) =>
        evaluateBuyCandidate({
          client,
          lensAddress: lensAddress as `0x${string}`,
          token,
          maxAmountIn: maxAmountIn as bigint,
          maxImpactBps,
          maxSlippageBps: riskPolicy.maxSlippageBps,
          allowedRouters
        })
      )
    )
  ).filter(isNonNull);

  if (buyCandidates.length === 0) {
    return holdDecision(input, 'no executable NadFun BUY route from allowlist', [
      'all candidate tokens failed quote/router/impact checks',
      'ensure allowlist tokens are active NadFun markets'
    ]);
  }

  buyCandidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.impactBps !== b.impactBps) return a.impactBps - b.impactBps;
    if (b.quoteAmountOut === a.quoteAmountOut) return 0;
    return b.quoteAmountOut > a.quoteAmountOut ? 1 : -1;
  });

  const buyPick = buyCandidates[0];
  const buyVenue = resolveNadfunVenue(buyPick.router, bondingRouter, dexRouter);
  if (!buyVenue) {
    return holdDecision(input, `unsupported NadFun router for BUY: ${buyPick.router}`);
  }

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
      tokenIn: wmon,
      tokenOut: buyPick.token,
      amountIn: String(buyPick.amountIn),
      minAmountOut: String(buyPick.minAmountOut),
      deadline,
      maxSlippageBps: riskPolicy.maxSlippageBps,
      snapshotHash: snapshot.snapshotHash
    },
    executionPlan: {
      venue: buyVenue,
      router: buyPick.router,
      quoteAmountOut: buyPick.quoteAmountOut.toString()
    },
    reason: `NadFun BUY token=${buyPick.token} router=${buyPick.router} impactBps=${buyPick.impactBps}`,
    riskChecks,
    confidence: 0.9,
    assumptions: [
      'token selection uses per-token NadFun lens quotes, not allowlist[0] shortcut',
      'BUY size is downscaled when quote impact exceeds STRATEGY_MAX_IMPACT_BPS',
      'execution route must use the same router returned by NadFun lens',
      `deadlineTtlSeconds=${deadlineTtlSeconds}`
    ]
  };
}

export async function proposeIntentAndSubmit(
  input: ProposeIntentAndSubmitInput
): Promise<ProposeIntentAndSubmitOutput> {
  const proposal = await proposeIntent(input);
  if (proposal.decision === 'HOLD') {
    return {
      status: 'OK',
      taskType: 'propose_intent',
      fundId: input.fundId,
      decision: 'HOLD',
      proposal
    };
  }

  const adapterAddress = requireAddress(
    input.adapterAddress ??
      process.env.NADFUN_EXECUTION_ADAPTER_ADDRESS ??
      process.env.ADAPTER_ADDRESS,
    'NADFUN_EXECUTION_ADAPTER_ADDRESS'
  );
  const vaultAddress = requireAddress(proposal.intent.vault, 'intent.vault');

  const intent: TradeIntent = {
    intentVersion: proposal.intent.intentVersion,
    vault: vaultAddress,
    action: proposal.intent.action,
    tokenIn: requireAddress(proposal.intent.tokenIn, 'intent.tokenIn'),
    tokenOut: requireAddress(proposal.intent.tokenOut, 'intent.tokenOut'),
    amountIn: requirePositiveBigInt(proposal.intent.amountIn, 'intent.amountIn'),
    minAmountOut: requirePositiveBigInt(proposal.intent.minAmountOut, 'intent.minAmountOut'),
    deadline: BigInt(proposal.intent.deadline),
    maxSlippageBps: BigInt(proposal.intent.maxSlippageBps),
    snapshotHash: proposal.intent.snapshotHash as Hex,
    reason: proposal.reason
  };
  const quoteAmountOut = requirePositiveBigInt(
    proposal.executionPlan.quoteAmountOut,
    'executionPlan.quoteAmountOut'
  );

  const recipient =
    intent.action === 'BUY' ? vaultAddress : adapterAddress;
  const token = intent.action === 'BUY' ? intent.tokenOut : intent.tokenIn;
  const adapterData = encodeNadfunExecutionDataV1({
    version: 1,
    action: intent.action,
    venue: proposal.executionPlan.venue,
    router: requireAddress(proposal.executionPlan.router, 'executionPlan.router'),
    recipient,
    token,
    deadline: intent.deadline,
    amountOutMin: intent.minAmountOut,
    extra: '0x'
  });
  const executionRoute: IntentExecutionRouteInput = {
    tokenIn: intent.tokenIn,
    tokenOut: intent.tokenOut,
    quoteAmountOut,
    minAmountOut: intent.minAmountOut,
    adapter: adapterAddress,
    adapterData
  };
  const allowlistHash = buildIntentAllowlistHashFromRoute(executionRoute);
  const maxNotional = requirePositiveBigInt(input.riskPolicy.maxNotional, 'riskPolicy.maxNotional');
  const canonical = buildCanonicalIntentRecord({
    intent,
    allowlistHash,
    maxNotional
  });

  const trustedRelayerHosts = envCsv('STRATEGY_TRUSTED_RELAYER_HOSTS');
  const relayerUrl = process.env.RELAYER_URL ?? '';
  if (!relayerUrl) {
    throw new Error('RELAYER_URL is required');
  }
  validateStrategyRelayerUrl(relayerUrl, trustedRelayerHosts);

  const requireExplicitSubmit = envBool(
    'STRATEGY_REQUIRE_EXPLICIT_SUBMIT',
    DEFAULT_REQUIRE_EXPLICIT_SUBMIT
  );
  const autoSubmitEnabled = envBool('STRATEGY_AUTO_SUBMIT', DEFAULT_AUTO_SUBMIT);
  const submitRequested = input.submit ?? false;
  const shouldSubmit = submitRequested || (!requireExplicitSubmit && autoSubmitEnabled);

  if (submitRequested && !autoSubmitEnabled) {
    throw new Error(
      'submit was requested but STRATEGY_AUTO_SUBMIT is disabled. Set STRATEGY_AUTO_SUBMIT=true to allow external submission.'
    );
  }

  if (!shouldSubmit) {
    return {
      status: 'OK',
      taskType: 'propose_intent',
      fundId: input.fundId,
      decision: 'READY',
      proposal,
      intentHash: canonical.intentHash,
      executionRoute: {
        tokenIn: executionRoute.tokenIn,
        tokenOut: executionRoute.tokenOut,
        quoteAmountOut: executionRoute.quoteAmountOut.toString(),
        minAmountOut: executionRoute.minAmountOut.toString(),
        adapter: executionRoute.adapter,
        adapterData: executionRoute.adapterData ?? '0x',
        allowlistHash: canonical.constraints.allowlistHash
      },
      relayer: {
        submitted: false,
        duplicate: false
      },
      onchain: {
        submitted: false,
        skippedExisting: false
      },
      safety: {
        submitRequested,
        autoSubmitEnabled,
        requireExplicitSubmit,
        trustedRelayerHosts
      }
    };
  }

  const intentBookAddress = requireAddress(
    input.intentBookAddress ?? process.env.INTENT_BOOK_ADDRESS,
    'INTENT_BOOK_ADDRESS'
  );
  const strategySignerAddress = requireAddress(
    input.strategySignerAddress ?? process.env.STRATEGY_ADDRESS,
    'STRATEGY_ADDRESS (strategy signer)'
  );

  const relayer = createRelayerClient();
  let relayerSubmitted = false;
  let relayerDuplicate = false;
  let relayerResponse: Record<string, unknown> | undefined;
  try {
    const payload: RelayerProposeIntentInput = {
      intent: canonical.intent,
      executionRoute,
      maxNotional: canonical.constraints.maxNotional,
      intentURI: input.intentURI
    };
    relayerResponse = await relayer.proposeIntent(input.fundId, payload);
    relayerSubmitted = true;
  } catch (error) {
    if (error instanceof RelayerHttpError && error.status === 409) {
      relayerDuplicate = true;
    } else {
      throw error;
    }
  }

  const { chain, rpcUrl } = strategyRuntime();
  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl)
  });
  const strategySignerAccount = privateKeyToAccount(requireStrategyPrivateKey());
  if (strategySignerAccount.address.toLowerCase() !== strategySignerAddress.toLowerCase()) {
    throw new Error(
      `strategy signer mismatch: signer=${strategySignerAccount.address} expected=${strategySignerAddress}`
    );
  }
  const walletClient = createWalletClient({
    account: strategySignerAccount,
    chain,
    transport: http(rpcUrl)
  });

  const existing = (await publicClient.readContract({
    address: intentBookAddress,
    abi: INTENT_BOOK_SUBMISSION_ABI,
    functionName: 'getIntentExecutionData',
    args: [canonical.intentHash]
  })) as IntentExecutionDataTuple;

  const allowExistingOnchainIntent = input.allowExistingOnchainIntent ?? true;
  let onchainSubmitted = false;
  let onchainSkippedExisting = false;
  let txHash: Hex | undefined;

  if (existing[0]) {
    if (!allowExistingOnchainIntent) {
      throw new Error(
        `onchain intent already exists: ${canonical.intentHash} (set allowExistingOnchainIntent=true to continue)`
      );
    }
    onchainSkippedExisting = true;
  } else {
    const simulation = await publicClient.simulateContract({
      account: strategySignerAccount,
      address: intentBookAddress,
      abi: INTENT_BOOK_SUBMISSION_ABI,
      functionName: 'proposeIntent',
      args: [
        canonical.intentHash,
        input.intentURI ?? '',
        canonical.intent.snapshotHash,
        {
          allowlistHash: canonical.constraints.allowlistHash,
          maxSlippageBps: uint16FromBigInt(
            canonical.constraints.maxSlippageBps,
            'constraints.maxSlippageBps'
          ),
          maxNotional: canonical.constraints.maxNotional,
          deadline: canonical.constraints.deadline
        }
      ]
    });
    const onchainTxHash = await walletClient.writeContract(simulation.request);
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: onchainTxHash
    });
    if (receipt.status !== 'success') {
      throw new Error(`proposeIntent transaction reverted: ${onchainTxHash}`);
    }

    onchainSubmitted = true;
    txHash = onchainTxHash;
  }

  return {
    status: 'OK',
    taskType: 'propose_intent',
    fundId: input.fundId,
    decision: 'SUBMITTED',
    proposal,
    intentHash: canonical.intentHash,
    executionRoute: {
      tokenIn: executionRoute.tokenIn,
      tokenOut: executionRoute.tokenOut,
      quoteAmountOut: executionRoute.quoteAmountOut.toString(),
      minAmountOut: executionRoute.minAmountOut.toString(),
      adapter: executionRoute.adapter,
      adapterData: executionRoute.adapterData ?? '0x',
      allowlistHash: canonical.constraints.allowlistHash
    },
    relayer: {
      submitted: relayerSubmitted,
      duplicate: relayerDuplicate,
      response: relayerResponse
    },
    onchain: {
      submitted: onchainSubmitted,
      skippedExisting: onchainSkippedExisting,
      txHash
    },
    safety: {
      submitRequested,
      autoSubmitEnabled,
      requireExplicitSubmit,
      trustedRelayerHosts
    }
  };
}
