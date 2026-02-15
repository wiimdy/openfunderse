import type { Address } from '@claw/protocol-sdk';
import { formatEther, parseEther, type PublicClient } from 'viem';
import { curveAbi, lensAbi } from './abi.js';
import { NADFUN_TESTNET } from './config.js';

export interface NadfunTokenFlags {
  token: Address;
  locked: boolean;
  graduated: boolean;
  progressBps: number | null; // 0..10000 (lens)
}

export async function getTokenFlags(
  client: PublicClient,
  token: Address,
  input?: { curve?: Address; lens?: Address }
): Promise<NadfunTokenFlags> {
  const curve = input?.curve ?? NADFUN_TESTNET.curve;
  const lens = input?.lens ?? NADFUN_TESTNET.lens;

  const [locked, graduated, progress] = await Promise.all([
    client.readContract({
      address: curve,
      abi: curveAbi,
      functionName: 'isLocked',
      args: [token]
    }) as Promise<boolean>,
    client.readContract({
      address: curve,
      abi: curveAbi,
      functionName: 'isGraduated',
      args: [token]
    }) as Promise<boolean>,
    client
      .readContract({
        address: lens,
        abi: lensAbi,
        functionName: 'getProgress',
        args: [token]
      })
      .then((v) => Number(v))
      .catch(() => null)
  ]);

  return {
    token,
    locked,
    graduated,
    progressBps: progress
  };
}

export async function quoteAmountOut(
  client: PublicClient,
  token: Address,
  amountInMon: string,
  input?: { lens?: Address }
): Promise<{ router: Address; amountOut: bigint }> {
  const lens = input?.lens ?? NADFUN_TESTNET.lens;
  const amountIn = parseEther(amountInMon);
  const [router, amountOut] = (await client.readContract({
    address: lens,
    abi: lensAbi,
    functionName: 'getAmountOut',
    args: [token, amountIn, true]
  })) as readonly [Address, bigint];
  return { router, amountOut };
}

export interface BuyPressureWindow {
  lookbackBlocks: bigint;
  chunkSize: bigint;
  whaleThresholdMon: string;
  safeLagBlocks: bigint;
}

export interface BuyPressureStats {
  token: Address;
  buyMonWei: bigint;
  whaleCount: number;
}

function isBlockRangeTooLargeError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.toLowerCase().includes('block range too large') || msg.toLowerCase().includes('limited to');
}

export async function getBuyPressureStats(
  client: PublicClient,
  token: Address,
  input?: {
    curve?: Address;
    window?: Partial<BuyPressureWindow>;
  }
): Promise<BuyPressureStats> {
  const curve = input?.curve ?? NADFUN_TESTNET.curve;
  const window: BuyPressureWindow = {
    lookbackBlocks: 10_000n,
    chunkSize: 500n,
    whaleThresholdMon: '1',
    safeLagBlocks: 10n,
    ...(input?.window ?? {})
  };

  const latest = await client.getBlockNumber();
  const toBlock = latest > window.safeLagBlocks ? latest - window.safeLagBlocks : latest;
  const fromBlock = toBlock > window.lookbackBlocks ? toBlock - window.lookbackBlocks : 0n;
  const whaleThresholdWei = parseEther(window.whaleThresholdMon);

  let buyMonWei = 0n;
  let whaleCount = 0;

  // dRPC / public RPCs often impose tight eth_getLogs block-range limits.
  // We paginate and also adaptively reduce the range if the RPC rejects the query.
  for (let from = fromBlock; from <= toBlock; ) {
    let chunk = window.chunkSize;
    let done = false;

    while (!done) {
      const to = from + chunk > toBlock ? toBlock : from + chunk;
      try {
        const logs = await client.getContractEvents({
          address: curve,
          abi: curveAbi,
          eventName: 'CurveBuy',
          args: { token },
          fromBlock: from,
          toBlock: to
        });

        for (const b of logs) {
          const amountIn = b.args.amountIn ?? 0n;
          buyMonWei += amountIn;
          if (amountIn > whaleThresholdWei) {
            whaleCount += 1;
          }
        }

        from = to + 1n;
        done = true;
      } catch (error) {
        if (!isBlockRangeTooLargeError(error) || chunk <= 50n) {
          throw error;
        }
        chunk = chunk / 2n;
      }
    }
  }

  return { token, buyMonWei, whaleCount };
}

export function buyMonWeiToLogScore(buyMonWei: bigint): number {
  const mon = parseFloat(formatEther(buyMonWei));
  if (!Number.isFinite(mon) || mon <= 0) return 0;
  return Math.log(1 + mon);
}
