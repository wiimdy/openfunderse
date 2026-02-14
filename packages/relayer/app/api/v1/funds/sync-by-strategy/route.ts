import { NextResponse } from "next/server";
import {
  createPublicClient,
  decodeEventLog,
  defineChain,
  http,
  parseAbi,
  type Address,
  type Hex
} from "viem";
import { requireBotAuth } from "@/lib/bot-auth";
import { loadChainReadConfig, loadReadOnlyRuntimeConfig } from "@/lib/config";
import {
  getFund,
  getFundDeployment,
  getFundDeploymentByTxHash,
  upsertFund,
  upsertFundBot,
  upsertFundDeployment
} from "@/lib/supabase";

const FUND_FACTORY_ABI = parseAbi([
  "event FundDeployed(uint256 indexed fundId, address indexed fundOwner, address indexed strategyAgent, address intentBook, address core, address vault, address snapshotBook, address asset)"
]);

function asString(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function parseAddressField(value: unknown, fieldName: string): Address {
  const raw = asString(value);
  if (!/^0x[a-fA-F0-9]{40}$/.test(raw)) {
    throw new Error(`${fieldName} must be a valid 20-byte hex address`);
  }
  return raw as Address;
}

function parseTxHash(value: unknown, fieldName: string): Hex {
  const raw = asString(value);
  if (!/^0x[a-fA-F0-9]{64}$/.test(raw)) {
    throw new Error(`${fieldName} must be a valid tx hash`);
  }
  return raw.toLowerCase() as Hex;
}

function parseBigIntField(value: unknown, fieldName: string): bigint {
  try {
    return BigInt(String(value));
  } catch {
    throw new Error(`${fieldName} must be an integer`);
  }
}

function parseOptionalBigIntField(value: unknown, fieldName: string): bigint | null {
  if (value === undefined || value === null || value === "") return null;
  return parseBigIntField(value, fieldName);
}

function extractFundDeployedEvent(
  logs: Array<{
    address: Address;
    data: Hex;
    topics: readonly Hex[];
  }>,
  factoryAddress: Address
) {
  const lowerFactory = factoryAddress.toLowerCase();
  for (const log of logs) {
    if (log.address.toLowerCase() !== lowerFactory) continue;
    try {
      const topics = [...log.topics];
      if (topics.length === 0) {
        continue;
      }
      const decoded = decodeEventLog({
        abi: FUND_FACTORY_ABI,
        data: log.data,
        topics: topics as [Hex, ...Hex[]],
        strict: false
      });
      if (decoded.eventName !== "FundDeployed") {
        continue;
      }
      const args = decoded.args as {
        fundId?: bigint;
        fundOwner?: Address;
        strategyAgent?: Address;
        intentBook?: Address;
        core?: Address;
        vault?: Address;
        snapshotBook?: Address;
        asset?: Address;
      };
      if (
        args.fundId === undefined ||
        !args.fundOwner ||
        !args.strategyAgent ||
        !args.intentBook ||
        !args.core ||
        !args.vault ||
        !args.snapshotBook ||
        !args.asset
      ) {
        continue;
      }

      return {
        fundId: args.fundId,
        fundOwner: args.fundOwner,
        strategyAgent: args.strategyAgent,
        intentBookAddress: args.intentBook,
        clawCoreAddress: args.core,
        clawVaultAddress: args.vault,
        snapshotBookAddress: args.snapshotBook,
        assetAddress: args.asset
      };
    } catch {
      continue;
    }
  }
  return null;
}

export async function POST(request: Request) {
  const botAuth = requireBotAuth(request, ["funds.bootstrap"]);
  if (!botAuth.ok) {
    return botAuth.response;
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      {
        error: "BAD_REQUEST",
        message: "invalid json body"
      },
      { status: 400 }
    );
  }

  let chainConfig: { chainId: bigint; rpcUrl: string; factoryAddress: Address };
  let defaults: {
    claimThresholdWeight: bigint;
    intentThresholdWeight: bigint;
  };
  try {
    chainConfig = loadChainReadConfig();
    const loaded = loadReadOnlyRuntimeConfig();
    defaults = {
      claimThresholdWeight: loaded.claimThresholdWeight,
      intentThresholdWeight: loaded.intentThresholdWeight
    };
  } catch (error) {
    return NextResponse.json(
      {
        error: "CONFIG_ERROR",
        message: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }

  let fundId: string;
  let fundName: string;
  let strategyBotId: string;
  let strategyBotAddress: Address;
  let txHash: Hex;
  let verifierThresholdWeight: bigint;
  let intentThresholdWeight: bigint;
  try {
    fundId = asString(body.fundId);
    fundName = asString(body.fundName);
    strategyBotId = asString(body.strategyBotId);
    strategyBotAddress = parseAddressField(body.strategyBotAddress, "strategyBotAddress");
    txHash = parseTxHash(body.txHash, "txHash");

    if (!fundId) {
      throw new Error("fundId is required");
    }
    if (!fundName) {
      throw new Error("fundName is required");
    }
    if (!strategyBotId) {
      throw new Error("strategyBotId is required");
    }

    verifierThresholdWeight =
      parseOptionalBigIntField(body.verifierThresholdWeight, "verifierThresholdWeight") ??
      defaults.claimThresholdWeight;
    intentThresholdWeight =
      parseOptionalBigIntField(body.intentThresholdWeight, "intentThresholdWeight") ??
      defaults.intentThresholdWeight;
    if (
      verifierThresholdWeight <= BigInt(0) ||
      intentThresholdWeight <= BigInt(0)
    ) {
      throw new Error("threshold weights must be positive");
    }
  } catch (error) {
    return NextResponse.json(
      {
        error: "BAD_REQUEST",
        message: error instanceof Error ? error.message : String(error)
      },
      { status: 400 }
    );
  }

  if (strategyBotId !== botAuth.botId) {
    return NextResponse.json(
      {
        error: "FORBIDDEN",
        message: "strategyBotId must match authenticated bot id",
        authenticatedBotId: botAuth.botId,
        strategyBotId
      },
      { status: 403 }
    );
  }

  const existingFund = await getFund(fundId);
  if (
    existingFund &&
    existingFund.strategy_bot_id &&
    existingFund.strategy_bot_id !== strategyBotId
  ) {
    return NextResponse.json(
      {
        error: "CONFLICT",
        message: `strategy bot is immutable for fund ${fundId}. existing=${existingFund.strategy_bot_id}, incoming=${strategyBotId}`
      },
      { status: 409 }
    );
  }

  const existingByFund = await getFundDeployment(fundId);
  const existingByTx = await getFundDeploymentByTxHash(txHash);
  if (existingByTx && existingByTx.fund_id !== fundId) {
    return NextResponse.json(
      {
        error: "CONFLICT",
        message: `deploy tx already mapped to another fund: tx=${txHash}, existingFundId=${existingByTx.fund_id}`
      },
      { status: 409 }
    );
  }

  if (existingByFund && existingByFund.deploy_tx_hash.toLowerCase() !== txHash.toLowerCase()) {
    return NextResponse.json(
      {
        error: "CONFLICT",
        message: `fund already mapped to another deploy tx: fundId=${fundId}, existingTx=${existingByFund.deploy_tx_hash}, incomingTx=${txHash}`
      },
      { status: 409 }
    );
  }

  const chainId = Number(chainConfig.chainId);
  const publicClient = createPublicClient({
    chain: defineChain({
      id: chainId,
      name: `relayer-${chainId}`,
      nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
      rpcUrls: {
        default: { http: [chainConfig.rpcUrl] },
        public: { http: [chainConfig.rpcUrl] }
      }
    }),
    transport: http(chainConfig.rpcUrl)
  });

  let receipt: Awaited<ReturnType<typeof publicClient.getTransactionReceipt>>;
  try {
    receipt = await publicClient.getTransactionReceipt({ hash: txHash });
  } catch (error) {
    return NextResponse.json(
      {
        error: "TX_NOT_FOUND",
        message: error instanceof Error ? error.message : String(error),
        txHash
      },
      { status: 404 }
    );
  }
  if (receipt.status !== "success") {
    return NextResponse.json(
      {
        error: "TX_REVERTED",
        message: "createFund transaction did not succeed",
        txHash
      },
      { status: 409 }
    );
  }

  const deployed = extractFundDeployedEvent(
    receipt.logs as Array<{
      address: Address;
      data: Hex;
      topics: readonly Hex[];
    }>,
    chainConfig.factoryAddress
  );
  if (!deployed) {
    return NextResponse.json(
      {
        error: "EVENT_NOT_FOUND",
        message: "FundDeployed event not found for configured factory",
        txHash,
        factoryAddress: chainConfig.factoryAddress
      },
      { status: 422 }
    );
  }

  if (deployed.strategyAgent.toLowerCase() !== strategyBotAddress.toLowerCase()) {
    return NextResponse.json(
      {
        error: "STRATEGY_MISMATCH",
        message:
          "FundDeployed.strategyAgent does not match strategyBotAddress in request",
        expected: strategyBotAddress,
        actual: deployed.strategyAgent
      },
      { status: 409 }
    );
  }

  const tx = await publicClient.getTransaction({ hash: txHash });

  await upsertFundDeployment({
    fundId,
    chainId: chainConfig.chainId,
    factoryAddress: chainConfig.factoryAddress,
    onchainFundId: deployed.fundId,
    intentBookAddress: deployed.intentBookAddress,
    clawCoreAddress: deployed.clawCoreAddress,
    clawVaultAddress: deployed.clawVaultAddress,
    fundOwnerAddress: deployed.fundOwner,
    strategyAgentAddress: deployed.strategyAgent,
    snapshotBookAddress: deployed.snapshotBookAddress,
    assetAddress: deployed.assetAddress,
    deployTxHash: txHash,
    deployBlockNumber: receipt.blockNumber,
    deployerAddress: tx.from
  });

  await upsertFund({
    fundId,
    fundName,
    strategyBotId,
    strategyBotAddress,
    verifierThresholdWeight,
    intentThresholdWeight,
    strategyPolicyUri: body.strategyPolicyUri ? String(body.strategyPolicyUri) : null,
    telegramRoomId: body.telegramRoomId ? String(body.telegramRoomId) : null,
    createdBy: botAuth.botId
  });

  await upsertFundBot({
    fundId,
    botId: strategyBotId,
    role: "strategy",
    botAddress: strategyBotAddress,
    status: "ACTIVE",
    policyUri: body.strategyPolicyUri ? String(body.strategyPolicyUri) : null,
    telegramHandle: body.telegramHandle ? String(body.telegramHandle) : null,
    registeredBy: botAuth.botId
  });

  return NextResponse.json(
    {
      status: "OK",
      endpoint: "POST /api/v1/funds/sync-by-strategy",
      fund: {
        fundId,
        fundName,
        strategyBotId,
        strategyBotAddress,
        verifierThresholdWeight: verifierThresholdWeight.toString(),
        intentThresholdWeight: intentThresholdWeight.toString()
      },
      onchainDeployment: {
        chainId: chainConfig.chainId.toString(),
        factoryAddress: chainConfig.factoryAddress,
        txHash,
        blockNumber: receipt.blockNumber.toString(),
        fundId: deployed.fundId.toString(),
        fundOwner: deployed.fundOwner,
        strategyAgent: deployed.strategyAgent,
        snapshotBookAddress: deployed.snapshotBookAddress,
        assetAddress: deployed.assetAddress,
        intentBookAddress: deployed.intentBookAddress,
        clawCoreAddress: deployed.clawCoreAddress,
        clawVaultAddress: deployed.clawVaultAddress,
        deployerAddress: tx.from
      }
    },
    { status: 200 }
  );
}
