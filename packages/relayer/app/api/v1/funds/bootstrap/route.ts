import { NextResponse } from "next/server";
import type { Address } from "@claw/protocol-sdk";
import { requireAdminSession } from "@/lib/authz";
import { loadReadOnlyRuntimeConfig } from "@/lib/config";
import { createFundOnchain, type DeployConfigInput } from "@/lib/onchain-factory";
import {
  getFundDeployment,
  getFund,
  upsertFund,
  upsertFundBot,
  upsertFundDeployment
} from "@/lib/supabase";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function parseBigIntField(value: unknown, fieldName: string): bigint {
  try {
    return BigInt(String(value));
  } catch {
    throw new Error(`${fieldName} must be an integer`);
  }
}

function parseOptionalBigIntField(
  value: unknown,
  fieldName: string
): bigint | null {
  if (value === undefined || value === null || value === "") return null;
  return parseBigIntField(value, fieldName);
}

function parseAddressField(value: unknown, fieldName: string): Address {
  const raw = asString(value);
  if (!/^0x[a-fA-F0-9]{40}$/.test(raw)) {
    throw new Error(`${fieldName} must be a valid 20-byte hex address`);
  }
  return raw as Address;
}

function parseOptionalAddressField(
  value: unknown,
  fieldName: string
): Address | null {
  if (value === undefined || value === null || value === "") return null;
  const raw = asString(value);
  if (!/^0x[a-fA-F0-9]{40}$/.test(raw)) {
    throw new Error(`${fieldName} must be a valid 20-byte hex address`);
  }
  return raw as Address;
}

function parseAddressArray(value: unknown, fieldName: string): Address[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array`);
  }
  return value.map((entry, index) =>
    parseAddressField(entry, `${fieldName}[${index}]`)
  );
}

function parseBigIntArray(value: unknown, fieldName: string): bigint[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array`);
  }
  return value.map((entry, index) =>
    parseBigIntField(entry, `${fieldName}[${index}]`)
  );
}

export async function POST(request: Request) {
  const admin = await requireAdminSession();
  if (!admin.ok) {
    return admin.response;
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "invalid json body" },
      { status: 400 }
    );
  }

  const fundId = asString(body.fundId);
  const fundName = asString(body.fundName);
  const strategyBotId = asString(body.strategyBotId);

  if (!fundId) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "fundId is required." },
      { status: 400 }
    );
  }
  if (!fundName) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "fundName is required." },
      { status: 400 }
    );
  }
  if (!strategyBotId) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "strategyBotId is required." },
      { status: 400 }
    );
  }

  const existing = await getFund(fundId);
  const existingDeployment = await getFundDeployment(fundId);
  if (existing && existing.strategy_bot_id && existing.strategy_bot_id !== strategyBotId) {
    return NextResponse.json(
      {
        error: "CONFLICT",
        message: `strategy bot is immutable for fund ${fundId}. existing=${existing.strategy_bot_id}, incoming=${strategyBotId}`
      },
      { status: 409 }
    );
  }

  let deployed:
    | {
        chainId: bigint;
        factoryAddress: Address;
        txHash: `0x${string}`;
        blockNumber: bigint;
        fundId: bigint;
        fundOwner: Address;
        strategyAgent: Address;
        snapshotBookAddress: Address;
        assetAddress: Address;
        intentBookAddress: Address;
        clawCoreAddress: Address;
        clawVaultAddress: Address;
        deployerAddress: Address;
      }
    | null = null;
  let reusedOnchainDeployment = false;

  const defaults = loadReadOnlyRuntimeConfig();
  const deployConfigRaw = asObject(body.deployConfig);
  if (!deployConfigRaw) {
    return NextResponse.json(
      {
        error: "BAD_REQUEST",
        message: "deployConfig is required and must be an object."
      },
      { status: 400 }
    );
  }

  let deployConfig: DeployConfigInput;
  let verifierThresholdWeight: bigint;
  let intentThresholdWeight: bigint;
  let strategyBotAddress: Address;

  try {
    const fundOwner = parseAddressField(deployConfigRaw.fundOwner, "deployConfig.fundOwner");
    const snapshotBook = parseAddressField(
      deployConfigRaw.snapshotBook,
      "deployConfig.snapshotBook"
    );
    const asset = parseAddressField(deployConfigRaw.asset, "deployConfig.asset");
    const vaultName = asString(deployConfigRaw.vaultName);
    const vaultSymbol = asString(deployConfigRaw.vaultSymbol);
    if (!vaultName || !vaultSymbol) {
      throw new Error("deployConfig.vaultName and deployConfig.vaultSymbol are required");
    }

    const strategyAgent =
      parseOptionalAddressField(deployConfigRaw.strategyAgent, "deployConfig.strategyAgent") ??
      (ZERO_ADDRESS as Address);
    const nadfunLens =
      parseOptionalAddressField(deployConfigRaw.nadfunLens, "deployConfig.nadfunLens") ??
      (ZERO_ADDRESS as Address);
    const initialVerifiers = parseAddressArray(
      deployConfigRaw.initialVerifiers,
      "deployConfig.initialVerifiers"
    );
    const initialVerifierWeights = parseBigIntArray(
      deployConfigRaw.initialVerifierWeights,
      "deployConfig.initialVerifierWeights"
    );
    const initialAllowedTokens = parseAddressArray(
      deployConfigRaw.initialAllowedTokens,
      "deployConfig.initialAllowedTokens"
    );
    const initialAllowedAdapters = parseAddressArray(
      deployConfigRaw.initialAllowedAdapters,
      "deployConfig.initialAllowedAdapters"
    );

    if (initialVerifiers.length !== initialVerifierWeights.length) {
      throw new Error(
        "deployConfig.initialVerifiers and deployConfig.initialVerifierWeights lengths must match"
      );
    }
    if (initialVerifierWeights.some((weight) => weight <= BigInt(0))) {
      throw new Error("deployConfig.initialVerifierWeights must contain only positive integers");
    }

    const deployIntentThresholdWeight =
      parseOptionalBigIntField(
        deployConfigRaw.intentThresholdWeight,
        "deployConfig.intentThresholdWeight"
      ) ?? defaults.intentThresholdWeight;
    if (deployIntentThresholdWeight <= BigInt(0)) {
      throw new Error("deployConfig.intentThresholdWeight must be positive");
    }

    verifierThresholdWeight =
      parseOptionalBigIntField(body.verifierThresholdWeight, "verifierThresholdWeight") ??
      defaults.claimThresholdWeight;
    if (verifierThresholdWeight <= BigInt(0)) {
      throw new Error("verifierThresholdWeight must be positive");
    }

    intentThresholdWeight =
      parseOptionalBigIntField(body.intentThresholdWeight, "intentThresholdWeight") ??
      deployIntentThresholdWeight;
    if (intentThresholdWeight <= BigInt(0)) {
      throw new Error("intentThresholdWeight must be positive");
    }

    strategyBotAddress = parseAddressField(
      body.strategyBotAddress ?? (strategyAgent === ZERO_ADDRESS ? fundOwner : strategyAgent),
      "strategyBotAddress"
    );

    deployConfig = {
      fundOwner,
      strategyAgent,
      snapshotBook,
      asset,
      vaultName,
      vaultSymbol,
      intentThresholdWeight: deployIntentThresholdWeight,
      nadfunLens,
      initialVerifiers,
      initialVerifierWeights,
      initialAllowedTokens,
      initialAllowedAdapters
    };
  } catch (error) {
    return NextResponse.json(
      {
        error: "BAD_REQUEST",
        message: error instanceof Error ? error.message : String(error)
      },
      { status: 400 }
    );
  }

  if (existingDeployment) {
    const expectedStrategyAgent =
      deployConfig.strategyAgent === ZERO_ADDRESS
        ? deployConfig.fundOwner
        : deployConfig.strategyAgent;

    if (
      existingDeployment.fund_owner_address.toLowerCase() !==
        deployConfig.fundOwner.toLowerCase() ||
      existingDeployment.snapshot_book_address.toLowerCase() !==
        deployConfig.snapshotBook.toLowerCase() ||
      existingDeployment.asset_address.toLowerCase() !==
        deployConfig.asset.toLowerCase() ||
      existingDeployment.strategy_agent_address.toLowerCase() !==
        expectedStrategyAgent.toLowerCase()
    ) {
      return NextResponse.json(
        {
          error: "EXISTING_DEPLOYMENT_MISMATCH",
          message:
            "fundId already has an onchain deployment with different owner/strategy/snapshot/asset config"
        },
        { status: 409 }
      );
    }
  }

  if (existingDeployment) {
    try {
      deployed = {
        chainId: BigInt(existingDeployment.chain_id),
        factoryAddress: existingDeployment.factory_address as Address,
        txHash: existingDeployment.deploy_tx_hash as `0x${string}`,
        blockNumber: BigInt(existingDeployment.deploy_block_number),
        fundId: BigInt(existingDeployment.onchain_fund_id),
        fundOwner: existingDeployment.fund_owner_address as Address,
        strategyAgent: existingDeployment.strategy_agent_address as Address,
        snapshotBookAddress: existingDeployment.snapshot_book_address as Address,
        assetAddress: existingDeployment.asset_address as Address,
        intentBookAddress: existingDeployment.intent_book_address as Address,
        clawCoreAddress: existingDeployment.claw_core_address as Address,
        clawVaultAddress: existingDeployment.claw_vault_address as Address,
        deployerAddress: existingDeployment.deployer_address as Address
      };
      reusedOnchainDeployment = true;
    } catch (error) {
      return NextResponse.json(
        {
          error: "INVALID_EXISTING_DEPLOYMENT",
          message:
            error instanceof Error
              ? error.message
              : "invalid persisted deployment row"
        },
        { status: 500 }
      );
    }
  } else {
    try {
      deployed = await createFundOnchain(deployConfig);
    } catch (error) {
      return NextResponse.json(
        {
          error: "ONCHAIN_DEPLOY_FAILED",
          message: error instanceof Error ? error.message : String(error)
        },
        { status: 502 }
      );
    }

    try {
      await upsertFundDeployment({
        fundId,
        chainId: deployed.chainId,
        factoryAddress: deployed.factoryAddress,
        onchainFundId: deployed.fundId,
        intentBookAddress: deployed.intentBookAddress,
        clawCoreAddress: deployed.clawCoreAddress,
        clawVaultAddress: deployed.clawVaultAddress,
        fundOwnerAddress: deployed.fundOwner,
        strategyAgentAddress: deployed.strategyAgent,
        snapshotBookAddress: deployed.snapshotBookAddress,
        assetAddress: deployed.assetAddress,
        deployTxHash: deployed.txHash,
        deployBlockNumber: deployed.blockNumber,
        deployerAddress: deployed.deployerAddress
      });
    } catch (error) {
      return NextResponse.json(
        {
          error: "PERSIST_DEPLOYMENT_FAILED",
          message: error instanceof Error ? error.message : String(error),
          onchainDeployment: {
            chainId: deployed.chainId.toString(),
            factoryAddress: deployed.factoryAddress,
            txHash: deployed.txHash,
            fundId: deployed.fundId.toString(),
            intentBookAddress: deployed.intentBookAddress,
            clawCoreAddress: deployed.clawCoreAddress,
            clawVaultAddress: deployed.clawVaultAddress
          }
        },
        { status: 500 }
      );
    }
  }

  try {
    await upsertFund({
      fundId,
      fundName,
      strategyBotId,
      strategyBotAddress,
      verifierThresholdWeight,
      intentThresholdWeight,
      strategyPolicyUri: body.strategyPolicyUri ? String(body.strategyPolicyUri) : null,
      telegramRoomId: body.telegramRoomId ? String(body.telegramRoomId) : null,
      createdBy: admin.adminId
    });

    await upsertFundBot({
      fundId,
      botId: strategyBotId,
      role: "strategy",
      botAddress: strategyBotAddress,
      status: "ACTIVE",
      policyUri: body.strategyPolicyUri ? String(body.strategyPolicyUri) : null,
      telegramHandle: body.telegramHandle ? String(body.telegramHandle) : null,
      registeredBy: admin.adminId
    });
  } catch (error) {
    if (!deployed) {
      return NextResponse.json(
        {
          error: "PERSIST_FAILED",
          message: error instanceof Error ? error.message : String(error)
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        error: "PERSIST_FAILED",
        message: error instanceof Error ? error.message : String(error),
        onchainDeployment: {
          chainId: deployed.chainId.toString(),
          factoryAddress: deployed.factoryAddress,
          txHash: deployed.txHash,
          fundId: deployed.fundId.toString(),
          intentBookAddress: deployed.intentBookAddress,
          clawCoreAddress: deployed.clawCoreAddress,
          clawVaultAddress: deployed.clawVaultAddress
        }
      },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      status: "OK",
      endpoint: "POST /api/v1/funds/bootstrap",
      adminId: admin.adminId,
      fund: {
        fundId,
        fundName,
        strategyBotId,
        strategyBotAddress,
        verifierThresholdWeight: verifierThresholdWeight.toString(),
        intentThresholdWeight: intentThresholdWeight.toString()
      },
      onchainDeployment: {
        reused: reusedOnchainDeployment,
        chainId: deployed.chainId.toString(),
        factoryAddress: deployed.factoryAddress,
        txHash: deployed.txHash,
        blockNumber: deployed.blockNumber.toString(),
        fundId: deployed.fundId.toString(),
        fundOwner: deployed.fundOwner,
        strategyAgent: deployed.strategyAgent,
        snapshotBookAddress: deployed.snapshotBookAddress,
        assetAddress: deployed.assetAddress,
        intentBookAddress: deployed.intentBookAddress,
        clawCoreAddress: deployed.clawCoreAddress,
        clawVaultAddress: deployed.clawVaultAddress
      }
    },
    { status: 200 }
  );
}
