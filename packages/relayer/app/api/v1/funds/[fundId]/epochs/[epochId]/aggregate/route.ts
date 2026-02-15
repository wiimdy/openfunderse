import { NextResponse } from "next/server";
import { requireBotAuth } from "@/lib/bot-auth";
import { requireFundBotRole } from "@/lib/fund-bot-authz";
import { buildEpochStateRecord, type Hex } from "@claw/protocol-sdk";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
  type Address
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  getFund,
  getEpochStateByEpoch,
  getFundDeployment,
  listActiveFundParticipants,
  listAllocationClaimsByEpoch,
  listStakeWeightsByFund,
  upsertEpochState
} from "@/lib/supabase";
import { parseFundAllowlistTokens } from "@/lib/claim-validation";
import {
  computeStakeWeightedAggregate,
  filterAndWeighClaims
} from "@/lib/aggregate-logic";

const SNAPSHOT_BOOK_ABI = parseAbi([
  "function publishSnapshot(bytes32 snapshotRoot)",
  "function isSnapshotFinalized(bytes32 snapshotHash) view returns (bool)"
]);

function parseBigints(values: unknown[]): bigint[] {
  return values.map((value) => BigInt(String(value)));
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ fundId: string; epochId: string }> }
) {
  const { fundId, epochId } = await context.params;

  const botAuth = await requireBotAuth(_request, ["intents.propose"]);
  if (!botAuth.ok) {
    return botAuth.response;
  }

  const membership = await requireFundBotRole({
    fundId,
    botId: botAuth.botId,
    allowedRoles: ["strategy"]
  });
  if (!membership.ok) {
    return membership.response;
  }

  let epoch: bigint;
  try {
    epoch = BigInt(epochId);
  } catch {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "epochId must be an integer" },
      { status: 400 }
    );
  }

  const rows = await listAllocationClaimsByEpoch({ fundId, epochId: epoch });
  if (rows.length === 0) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "no allocation claims for epoch" },
      { status: 400 }
    );
  }

  const latestByParticipant = new Map<string, { weights: bigint[]; claimHash: Hex; createdAt: number }>();
  for (const row of rows) {
    const payload = JSON.parse(row.claim_json) as { targetWeights?: unknown[] };
    const weightsRaw = payload.targetWeights;
    if (!Array.isArray(weightsRaw) || weightsRaw.length === 0) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: `invalid targetWeights in claim ${row.claim_hash}` },
        { status: 400 }
      );
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

  const fund = await getFund(fundId);
  const allowlistTokens = fund ? parseFundAllowlistTokens(fund) : null;
  const expectedDim =
    allowlistTokens && allowlistTokens.length > 0 ? allowlistTokens.length : null;

  const activeParticipants = await listActiveFundParticipants(fundId);
  const registeredSet = new Set(
    activeParticipants.map((bot) => bot.bot_address.toLowerCase())
  );

  const stakeRows = await listStakeWeightsByFund(fundId);
  const stakeMap = new Map(
    stakeRows.map((row) => [row.participant.toLowerCase(), row.weight])
  );

  const claimEntries = Array.from(latestByParticipant.entries()).map(
    ([participant, item]) => ({
      participant,
      weights: item.weights,
      claimHash: item.claimHash as string
    })
  );

  const filtered = filterAndWeighClaims({
    claims: claimEntries,
    registeredParticipants: registeredSet,
    stakeMap,
    expectedDimensions: expectedDim
  });

  if (filtered.included.length === 0) {
    return NextResponse.json(
      {
        error: "BAD_REQUEST",
        message:
          "no valid claims after filtering (unregistered, no stake, or dimension mismatch)",
        validation: {
          totalClaimsFound: rows.length,
          uniqueParticipants: latestByParticipant.size,
          skippedUnregistered: filtered.skipped.unregistered.length,
          skippedNoStake: filtered.skipped.noStake.length,
          skippedDimensionMismatch: filtered.skipped.dimensionMismatch.length
        }
      },
      { status: 400 }
    );
  }

  const dimensions = filtered.included[0].weights.length;
  const aggregateWeights = computeStakeWeightedAggregate(filtered.included, dimensions);
  const claimScale = filtered.included[0].weights.reduce((a, b) => a + b, BigInt(0));

  const claimHashes = filtered.included
    .map((claim) => claim.claimHash)
    .sort((a, b) => a.localeCompare(b)) as Hex[];

  const epochState = buildEpochStateRecord({
    epochId: epoch,
    claimHashes
  });

  const deployment = await getFundDeployment(fundId);
  if (!deployment) {
    return NextResponse.json(
      {
        error: "BAD_REQUEST",
        message: "fund is not deployed yet (missing onchain deployment metadata)"
      },
      { status: 400 }
    );
  }

  const snapshotBookAddress = deployment.snapshot_book_address as Address;
  if (!/^0x[a-fA-F0-9]{40}$/.test(snapshotBookAddress)) {
    return NextResponse.json(
      {
        error: "BAD_REQUEST",
        message: "invalid snapshotBook address in deployment",
        snapshotBookAddress
      },
      { status: 400 }
    );
  }

  const chainIdRaw = process.env.CHAIN_ID ?? "";
  const rpcUrl = process.env.RPC_URL ?? "";
  const chainIdNum = Number(chainIdRaw);
  if (!Number.isFinite(chainIdNum) || chainIdNum <= 0) {
    return NextResponse.json(
      { error: "CONFIG_ERROR", message: "CHAIN_ID must be a positive number" },
      { status: 500 }
    );
  }
  if (!rpcUrl) {
    return NextResponse.json(
      { error: "CONFIG_ERROR", message: "RPC_URL is required" },
      { status: 500 }
    );
  }

  const chain = defineChain({
    id: Math.trunc(chainIdNum),
    name: `claw-${Math.trunc(chainIdNum)}`,
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

  const alreadyPublished = (await publicClient.readContract({
    address: snapshotBookAddress,
    abi: SNAPSHOT_BOOK_ABI,
    functionName: "isSnapshotFinalized",
    args: [epochState.epochStateHash]
  })) as boolean;

  const existingEpochState = await getEpochStateByEpoch({ fundId, epochId: epoch });
  if (alreadyPublished && existingEpochState) {
    return NextResponse.json(
      {
        status: "ALREADY_AGGREGATED",
        endpoint: "POST /api/v1/funds/{fundId}/epochs/{epochId}/aggregate",
        fundId,
        epochId: epoch.toString(),
        epochStateHash: existingEpochState.epoch_state_hash,
        snapshotBookAddress,
        snapshotPublish: { alreadyPublished: true, txHash: null }
      },
      { status: 200 }
    );
  }

  let publishTxHash: Hex | null = null;
  if (!alreadyPublished) {
    const signerKey =
      process.env.SNAPSHOT_PUBLISHER_PRIVATE_KEY ??
      process.env.RELAYER_SIGNER_PRIVATE_KEY ??
      process.env.EXECUTOR_PRIVATE_KEY;
    if (!signerKey || !/^0x[0-9a-fA-F]{64}$/.test(signerKey)) {
      return NextResponse.json(
        {
          error: "CONFIG_ERROR",
          message:
            "missing required key to publish snapshot (set SNAPSHOT_PUBLISHER_PRIVATE_KEY or RELAYER_SIGNER_PRIVATE_KEY or EXECUTOR_PRIVATE_KEY)"
        },
        { status: 500 }
      );
    }

    const account = privateKeyToAccount(signerKey as Hex);
    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl)
    });

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
      return NextResponse.json(
        {
          error: "ONCHAIN_ERROR",
          message: `publishSnapshot reverted: ${publishTxHash}`,
          txHash: publishTxHash
        },
        { status: 500 }
      );
    }

    const finalizedAfter = (await publicClient.readContract({
      address: snapshotBookAddress,
      abi: SNAPSHOT_BOOK_ABI,
      functionName: "isSnapshotFinalized",
      args: [epochState.epochStateHash]
    })) as boolean;
    if (!finalizedAfter) {
      return NextResponse.json(
        {
          error: "ONCHAIN_ERROR",
          message: "snapshot root publish succeeded but read-back check failed",
          txHash: publishTxHash
        },
        { status: 500 }
      );
    }
  }

  await upsertEpochState({
    fundId,
    epochId: epoch,
    epochStateHash: epochState.epochStateHash,
    aggregateWeightsJson: JSON.stringify(aggregateWeights.map((v) => v.toString())),
    claimHashes
  });

  return NextResponse.json(
    {
      status: "OK",
      endpoint: "POST /api/v1/funds/{fundId}/epochs/{epochId}/aggregate",
      fundId,
      epochId: epoch.toString(),
      epochStateHash: epochState.epochStateHash,
      snapshotBookAddress,
      snapshotPublish: {
        alreadyPublished,
        txHash: publishTxHash
      },
      claimScale: claimScale.toString(),
      participantCount: filtered.included.length,
      claimCount: claimHashes.length,
      aggregateWeights: aggregateWeights.map((v) => v.toString()),
      rewardSettlement: {
        status: "TODO",
        message: "Reward/mint settlement is out of MVP scope (formula-only)."
      },
      validation: {
        totalClaimsFound: rows.length,
        uniqueParticipants: latestByParticipant.size,
        includedAfterFilter: filtered.included.length,
        skippedUnregistered: filtered.skipped.unregistered.length,
        skippedNoStake: filtered.skipped.noStake.length,
        skippedDimensionMismatch: filtered.skipped.dimensionMismatch.length
      }
    },
    { status: 200 }
  );
}
