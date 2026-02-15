import type { Address } from '@claw/protocol-sdk';
import type { PublicClient } from 'viem';
import { DEFAULT_WEIGHT_SCALE, MVP_ALLOWLIST, NADFUN_TESTNET } from '../nadfun/config.js';
import {
  buyMonWeiToLogScore,
  getBuyPressureStats,
  getTokenFlags,
  quoteAmountOut
} from '../nadfun/metrics.js';
import { intifyBigintScores, intifyNumberScores } from '../nadfun/intify.js';

export type ParticipantStrategyId = 'A' | 'B' | 'C';

export interface StrategyContext {
  client: PublicClient;
  allowlist?: readonly Address[];
  curve?: Address;
  lens?: Address;
  weightScale?: bigint;
}

export async function computeTargetWeights(
  strategy: ParticipantStrategyId,
  ctx: StrategyContext
): Promise<bigint[]> {
  const allowlist = (ctx.allowlist ?? MVP_ALLOWLIST).map((v) => v.toLowerCase() as Address);
  const curve = ctx.curve ?? NADFUN_TESTNET.curve;
  const lens = ctx.lens ?? NADFUN_TESTNET.lens;
  const scale = ctx.weightScale ?? DEFAULT_WEIGHT_SCALE;

  if (strategy === 'A') {
    // Momentum (buy pressure) via CurveBuy logs + lock filter.
    const stats = await Promise.all(
      allowlist.map(async (token) => {
        const flags = await getTokenFlags(ctx.client, token, { curve, lens });
        if (flags.locked) {
          return { token, score: 0 };
        }
        const window = {
          lookbackBlocks: BigInt(process.env.PARTICIPANT_A_LOOKBACK_BLOCKS ?? '10000'),
          chunkSize: BigInt(process.env.PARTICIPANT_A_CHUNK_SIZE ?? '500'),
          whaleThresholdMon: process.env.PARTICIPANT_A_WHALE_THRESHOLD_MON ?? '1'
        };
        const pressure = await getBuyPressureStats(ctx.client, token, { curve, window });
        const s = buyMonWeiToLogScore(pressure.buyMonWei) + 0.3 * pressure.whaleCount;
        return { token, score: s };
      })
    );

    const scores = stats.map((s) => s.score);
    return intifyNumberScores(scores, scale);
  }

  if (strategy === 'B') {
    // Graduation proximity via getProgress + lock/graduated filters.
    const pMin = Number(process.env.PARTICIPANT_B_PROGRESS_MIN ?? '8000');
    const pMax = Number(process.env.PARTICIPANT_B_PROGRESS_MAX ?? '9900');
    const center = Number(process.env.PARTICIPANT_B_PROGRESS_CENTER ?? '9000');
    const width = Number(process.env.PARTICIPANT_B_PROGRESS_WIDTH ?? '900');

    const scores = await Promise.all(
      allowlist.map(async (token) => {
        const flags = await getTokenFlags(ctx.client, token, { curve, lens });
        if (flags.locked || flags.graduated || flags.progressBps === null) return 0;
        const p = flags.progressBps;
        if (p < pMin || p > pMax) return 0;
        const s = 1 - Math.abs(p - center) / width;
        return s > 0 ? s : 0;
      })
    );

    return intifyNumberScores(scores, scale);
  }

  // strategy C
  const amountIn = process.env.PARTICIPANT_C_QUOTE_AMOUNT_IN_MON ?? '0.2';
  const impactMax = Number(process.env.PARTICIPANT_C_IMPACT_MAX ?? '0.05');
  const ratioScale = 1_000_000n;
  const minRatio = Math.max(0, 1 - impactMax); // require q2/(2*q1) >= minRatio
  const minRatioFixed = BigInt(Math.floor(minRatio * Number(ratioScale)));

  const scores = await Promise.all(
    allowlist.map(async (token) => {
      const flags = await getTokenFlags(ctx.client, token, { curve, lens });
      if (flags.locked) return 0n;
      try {
        const q1 = await quoteAmountOut(ctx.client, token, amountIn, { lens });
        const q2 = await quoteAmountOut(ctx.client, token, String(Number(amountIn) * 2), { lens });
        if (q1.amountOut <= 0n) return 0n;
        const denom = 2n * q1.amountOut;
        if (denom <= 0n) return 0n;
        const ratioFixed = (q2.amountOut * ratioScale) / denom; // ~ q2/(2*q1)
        if (ratioFixed < minRatioFixed) return 0n; // too much impact / non-linear
        // Score proportional to q1, discounted by impact (ratio closer to 1 is better).
        return q1.amountOut * ratioFixed;
      } catch {
        return 0n;
      }
    })
  );

  return intifyBigintScores(scores, scale);
}

