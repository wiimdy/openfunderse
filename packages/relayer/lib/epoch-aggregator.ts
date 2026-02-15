import { buildEpochStateRecord, type Hex } from "@claw/protocol-sdk";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Address
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  getEpochStateByEpoch,
  getFundDeployment,
  listAllocationClaimsByEpoch,
  listStakeWeightsByFund,
  upsertEpochState
} from "@/lib/supabase";
import {
  SNAPSHOT_BOOK_ABI,
  validateSnapshotBookInterface,
  isSnapshotBookValid
} from "@/lib/snapshot-book-validator";

export class AggregateError extends Error {
  constructor(
    message: string,
    public readonly code: "BAD_REQUEST" | "CONFIG_ERROR" | "ONCHAIN_ERROR",
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "AggregateError";
  }
}

export interface AggregateEpochResult {
  status: "OK" | "ALREADY_AGGREGATED";
  epochStateHash: string;
  snapshotBookAddress: string;
  snapshotPublish: {
    alreadyPublished: boolean;
    txHash: string | null;
  };
  claimScale: string;
  participantCount: number;
  claimCount: number;
  aggregateWeights: string[];
}

function parseBigints(values: unknown[]): bigint[] {
  return values.map((value) => {
    try {
      return BigInt(String(value));
    } catch {
      throw new AggregateError("targetWeights must contain only integer values", "BAD_REQUEST");
    }
  });
}

function sum(values: bigint[]): bigint {
  return values.reduce((acc, value) => acc + value, BigInt(0));
}

function getChainConfig(): { chainId: number; rpcUrl: string } {
  const chainIdRaw = process.env.CHAIN_ID ?? "";
  const rpcUrl = process.env.RPC_URL ?? "";
  const chainIdNum = Number(chainIdRaw);

  if (!Number.isFinite(chainIdNum) || chainIdNum <= 0) {
    throw new AggregateError("CHAIN_ID must be a positive number", "CONFIG_ERROR");
  }

  if (!rpcUrl) {
    throw new AggregateError("RPC_URL is required", "CONFIG_ERROR");
  }

  return {
    chainId: Math.trunc(chainIdNum),
    rpcUrl
  };
}

function getSnapshotPublisherKey(): Hex {
  const signerKey =
    process.env.SNAPSHOT_PUBLISHER_PRIVATE_KEY ??
    process.env.RELAYER_SIGNER_PRIVATE_KEY ??
    process.env.EXECUTOR_PRIVATE_KEY;

  if (!signerKey || !/^0x[0-9a-fA-F]{64}$/.test(signerKey)) {
    throw new AggregateError(
      "missing required key to publish snapshot (set SNAPSHOT_PUBLISHER_PRIVATE_KEY or RELAYER_SIGNER_PRIVATE_KEY or EXECUTOR_PRIVATE_KEY)",
      "CONFIG_ERROR"
    );
  }

  return signerKey as Hex;
}

export async function aggregateEpoch(
  fundId: string,
  epochId: bigint
): Promise<AggregateEpochResult> {
  const rows = await listAllocationClaimsByEpoch({ fundId, epochId });
  if (rows.length === 0) {
    throw new AggregateError("no allocation claims for epoch", "BAD_REQUEST");
  }

  const latestByParticipant = new Map<string, { weights: bigint[]; claimHash: Hex; createdAt: number }>();
  for (const row of rows) {
    let payload: { targetWeights?: unknown[] };
    try {
      payload = JSON.parse(row.claim_json) as { targetWeights?: unknown[] };
    } catch {
      throw new AggregateError(`invalid claim_json in claim ${row.claim_hash}`, "BAD_REQUEST");
    }

    const weightsRaw = payload.targetWeights;
    if (!Array.isArray(weightsRaw) || weightsRaw.length === 0) {
      throw new AggregateError(`invalid targetWeights in claim ${row.claim_hash}`, "BAD_REQUEST");
    }

    const weights = parseBigints(weightsRaw);
    const key = row.participant.toLowerCase();
    const prev = latestByParticipant.get(key);
    if (!prev || row.created_at > prev.createdAt) {
      latestByParticipant.set(key, {
        weights,
        claimHash: row.claim_hash as Hex,
        createdAt: row.created_at
      });
    }
  }

  const participants = Array.from(latestByParticipant.entries());
  const dimensions = participants[0]?.[1].weights.length;
  if (!dimensions || dimensions <= 0) {
    throw new AggregateError("targetWeights dimension must be positive", "BAD_REQUEST");
  }

  for (const [, item] of participants) {
    if (item.weights.length !== dimensions) {
      throw new AggregateError("targetWeights dimension mismatch", "BAD_REQUEST");
    }
  }

  const claimScale = sum(participants[0][1].weights);
  if (claimScale <= BigInt(0)) {
    throw new AggregateError("targetWeights sum must be positive", "BAD_REQUEST");
  }

  for (const [, item] of participants) {
    if (sum(item.weights) !== claimScale) {
      throw new AggregateError("targetWeights sum mismatch across participants", "BAD_REQUEST");
    }
  }

  const stakeRows = await listStakeWeightsByFund(fundId);
  const stakeMap = new Map(stakeRows.map((row) => [row.participant.toLowerCase(), row.weight]));

  let totalStake = BigInt(0);
  const participantStake = new Map<string, bigint>();
  for (const [participant] of participants) {
    const stake = stakeMap.get(participant) ?? BigInt(1);
    participantStake.set(participant, stake);
    totalStake += stake;
  }

  if (totalStake <= BigInt(0)) {
    throw new AggregateError("total stake must be positive", "BAD_REQUEST");
  }

  const aggregate = Array.from({ length: dimensions }, () => BigInt(0));
  for (const [participant, item] of participants) {
    const stake = participantStake.get(participant) ?? BigInt(0);
    for (let i = 0; i < dimensions; i += 1) {
      aggregate[i] += item.weights[i] * stake;
    }
  }

  const aggregateWeights = aggregate.map((numerator) => numerator / totalStake);
  const aggregateRemainder = claimScale - sum(aggregateWeights);
  if (aggregateRemainder !== BigInt(0) && aggregateWeights.length > 0) {
    aggregateWeights[0] += aggregateRemainder;
  }

  const claimHashes = participants
    .map(([, item]) => item.claimHash)
    .sort((a, b) => a.localeCompare(b));

  const epochState = buildEpochStateRecord({
    epochId,
    claimHashes
  });

  const deployment = await getFundDeployment(fundId);
  if (!deployment) {
    throw new AggregateError(
      "fund is not deployed yet (missing onchain deployment metadata)",
      "BAD_REQUEST"
    );
  }

  const snapshotBookAddress = deployment.snapshot_book_address as Address;
  if (!/^0x[a-fA-F0-9]{40}$/.test(snapshotBookAddress)) {
    throw new AggregateError("invalid snapshotBook address in deployment", "BAD_REQUEST", {
      snapshotBookAddress
    });
  }

  const { chainId, rpcUrl } = getChainConfig();
  const chain = defineChain({
    id: chainId,
    name: `claw-${chainId}`,
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: {
      default: { http: [rpcUrl] },
      public: { http: [rpcUrl] }
    }
  });

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl)
  });

  const validation = await validateSnapshotBookInterface(publicClient, snapshotBookAddress);
  if (!isSnapshotBookValid(validation)) {
    throw new AggregateError(
      `snapshotBook at ${snapshotBookAddress} does not implement SnapshotBook interface`,
      "ONCHAIN_ERROR",
      {
        snapshotBookAddress,
        validation: {
          hasCode: validation.hasCode,
          isSnapshotFinalizedCallable: validation.isSnapshotFinalizedCallable,
          errors: validation.errors
        }
      }
    );
  }

  let alreadyPublished = false;
  try {
    alreadyPublished = (await publicClient.readContract({
      address: snapshotBookAddress,
      abi: SNAPSHOT_BOOK_ABI,
      functionName: "isSnapshotFinalized",
      args: [epochState.epochStateHash]
    })) as boolean;
  } catch (error) {
    throw new AggregateError("failed to read snapshot finalization status", "ONCHAIN_ERROR", {
      cause: error instanceof Error ? error.message : String(error)
    });
  }

  const existingEpochState = await getEpochStateByEpoch({ fundId, epochId });
  if (alreadyPublished && existingEpochState) {
    return {
      status: "ALREADY_AGGREGATED",
      epochStateHash: existingEpochState.epoch_state_hash,
      snapshotBookAddress,
      snapshotPublish: { alreadyPublished: true, txHash: null },
      claimScale: claimScale.toString(),
      participantCount: participants.length,
      claimCount: claimHashes.length,
      aggregateWeights: aggregateWeights.map((v) => v.toString())
    };
  }

  let publishTxHash: Hex | null = null;
  if (!alreadyPublished) {
    const signerKey = getSnapshotPublisherKey();
    const account = privateKeyToAccount(signerKey);
    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl)
    });

    try {
      const simulation = await publicClient.simulateContract({
        account,
        address: snapshotBookAddress,
        abi: SNAPSHOT_BOOK_ABI,
        functionName: "publishSnapshot",
        args: [epochState.epochStateHash]
      });
      publishTxHash = await walletClient.writeContract(simulation.request);
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: publishTxHash
      });

      if (receipt.status !== "success") {
        throw new AggregateError(`publishSnapshot reverted: ${publishTxHash}`, "ONCHAIN_ERROR", {
          txHash: publishTxHash
        });
      }

      const finalizedAfter = (await publicClient.readContract({
        address: snapshotBookAddress,
        abi: SNAPSHOT_BOOK_ABI,
        functionName: "isSnapshotFinalized",
        args: [epochState.epochStateHash]
      })) as boolean;

      if (!finalizedAfter) {
        throw new AggregateError(
          "snapshot root publish succeeded but read-back check failed",
          "ONCHAIN_ERROR",
          { txHash: publishTxHash }
        );
      }
    } catch (error) {
      if (error instanceof AggregateError) {
        throw error;
      }
      throw new AggregateError("failed to publish snapshot onchain", "ONCHAIN_ERROR", {
        txHash: publishTxHash,
        cause: error instanceof Error ? error.message : String(error)
      });
    }
  }

  await upsertEpochState({
    fundId,
    epochId,
    epochStateHash: epochState.epochStateHash,
    aggregateWeightsJson: JSON.stringify(aggregateWeights.map((v) => v.toString())),
    claimHashes
  });

  return {
    status: "OK",
    epochStateHash: epochState.epochStateHash,
    snapshotBookAddress,
    snapshotPublish: {
      alreadyPublished,
      txHash: publishTxHash
    },
    claimScale: claimScale.toString(),
    participantCount: participants.length,
    claimCount: claimHashes.length,
    aggregateWeights: aggregateWeights.map((v) => v.toString())
  };
}
