import { createPublicClient, createWalletClient, defineChain, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildCoreExecutionRequestFromIntent,
  canonicalIntent,
  type Hex,
  type IntentExecutionRouteInput,
  type TradeIntent
} from "@claw/protocol-sdk";
import { incCounter } from "@/lib/metrics";
import {
  claimReadyExecutionJobs,
  getIntentByHash,
  markExecutionJobExecuted,
  markExecutionJobFailed
} from "@/lib/supabase";
import { loadExecutionConfig } from "@/lib/config";

const CORE_ABI = parseAbi([
  "function validateIntentExecution(bytes32 intentHash, (address tokenIn,address tokenOut,uint256 amountIn,uint256 quoteAmountOut,uint256 minAmountOut,address adapter,bytes adapterData) req) view returns ((bool exists,bool approved,bool notExpired,bool notExecuted,bool withinNotional,bool slippageOk,bool allowlistOk,bytes32 snapshotHash,uint64 deadline,uint16 maxSlippageBps,uint256 maxNotional,bytes32 expectedAllowlistHash,bytes32 computedAllowlistHash))",
  "function executeIntent(bytes32 intentHash, (address tokenIn,address tokenOut,uint256 amountIn,uint256 quoteAmountOut,uint256 minAmountOut,address adapter,bytes adapterData) req) returns (uint256 amountOut)"
]);

const RETRY_DELAYS_MS = [10_000, 30_000, 60_000, 180_000, 300_000];

function delayForAttempt(attempt: number): number {
  return RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)];
}

function clients() {
  const cfg = loadExecutionConfig();
  const chain = defineChain({
    id: Number(cfg.chainId),
    name: `claw-${cfg.chainId.toString(10)}`,
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: {
      default: { http: [cfg.rpcUrl] },
      public: { http: [cfg.rpcUrl] }
    }
  });
  const account = privateKeyToAccount(cfg.signerKey);
  const publicClient = createPublicClient({ chain, transport: http(cfg.rpcUrl) });
  const walletClient = createWalletClient({ account, chain, transport: http(cfg.rpcUrl) });
  return { cfg, account, publicClient, walletClient };
}

function parseIntentRow(intentJson: string): TradeIntent {
  const raw = JSON.parse(intentJson) as Record<string, string>;
  return canonicalIntent({
    intentVersion: String(raw.intentVersion),
    vault: raw.vault as `0x${string}`,
    action: String(raw.action) as "BUY" | "SELL",
    tokenIn: raw.tokenIn as `0x${string}`,
    tokenOut: raw.tokenOut as `0x${string}`,
    amountIn: BigInt(raw.amountIn),
    minAmountOut: BigInt(raw.minAmountOut),
    deadline: BigInt(raw.deadline),
    maxSlippageBps: BigInt(raw.maxSlippageBps),
    snapshotHash: raw.snapshotHash as `0x${string}`,
    reason: raw.reason ? String(raw.reason) : undefined
  });
}

function parseExecutionRoute(row: string): IntentExecutionRouteInput {
  const raw = JSON.parse(row) as Record<string, string>;
  return {
    tokenIn: raw.tokenIn as `0x${string}`,
    tokenOut: raw.tokenOut as `0x${string}`,
    quoteAmountOut: BigInt(raw.quoteAmountOut),
    minAmountOut: BigInt(raw.minAmountOut),
    adapter: raw.adapter as `0x${string}`,
    adapterData: raw.adapterData as `0x${string}`
  };
}

export async function runExecutionCron() {
  const { cfg, account, publicClient, walletClient } = clients();
  const jobs = await claimReadyExecutionJobs(cfg.batchLimit);
  const results: Array<Record<string, unknown>> = [];

  for (const job of jobs) {
    try {
      const row = await getIntentByHash(job.fund_id, job.intent_hash);
      if (!row) {
        await markExecutionJobFailed({
          id: job.id,
          attemptCount: job.attempt_count + 1,
          retryDelayMs: delayForAttempt(job.attempt_count + 1),
          maxAttempts: cfg.maxAttempts,
          error: "intent row not found"
        });
        results.push({ id: job.id, ok: false, error: "intent row not found" });
        continue;
      }

      const intent = parseIntentRow(row.intent_json);
      const executionRoute = parseExecutionRoute(row.execution_route_json);
      const req = buildCoreExecutionRequestFromIntent({ intent, executionRoute });

      const v = await publicClient.readContract({
        address: cfg.coreAddress,
        abi: CORE_ABI,
        functionName: "validateIntentExecution",
        args: [row.intent_hash as Hex, req]
      });

      if (
        !v.exists ||
        !v.approved ||
        !v.notExpired ||
        !v.notExecuted ||
        !v.withinNotional ||
        !v.slippageOk ||
        !v.allowlistOk
      ) {
        const error = `preflight failed: exists=${v.exists} approved=${v.approved} notExpired=${v.notExpired} notExecuted=${v.notExecuted} withinNotional=${v.withinNotional} slippageOk=${v.slippageOk} allowlistOk=${v.allowlistOk}`;
        await markExecutionJobFailed({
          id: job.id,
          attemptCount: job.attempt_count + 1,
          retryDelayMs: delayForAttempt(job.attempt_count + 1),
          maxAttempts: cfg.maxAttempts,
          error
        });
        incCounter("execution_preflight_fail");
        results.push({ id: job.id, ok: false, error });
        continue;
      }

      const nonce = await publicClient.getTransactionCount({
        address: account.address,
        blockTag: "pending"
      });
      const txHash = await walletClient.writeContract({
        address: cfg.coreAddress,
        abi: CORE_ABI,
        functionName: "executeIntent",
        args: [row.intent_hash as Hex, req],
        nonce,
        account
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      await markExecutionJobExecuted(job.id, txHash);
      incCounter("execution_success");
      results.push({ id: job.id, ok: true, txHash });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await markExecutionJobFailed({
        id: job.id,
        attemptCount: job.attempt_count + 1,
        retryDelayMs: delayForAttempt(job.attempt_count + 1),
        maxAttempts: cfg.maxAttempts,
        error: message
      });
      incCounter("execution_fail");
      results.push({ id: job.id, ok: false, error: message });
    }
  }

  return {
    batchSize: jobs.length,
    processed: results.length,
    results
  };
}
