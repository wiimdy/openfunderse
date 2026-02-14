import type { Address, Hex } from "@claw/protocol-sdk";

export type ClaimFinalizationMode = "OFFCHAIN" | "ONCHAIN";

function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing required env: ${name}`);
  }
  return value;
}

function envNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`invalid numeric env: ${name}`);
  }
  return num;
}

function envOptional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function parseClaimFinalizationMode(value: string | undefined): ClaimFinalizationMode {
  const mode = (value ?? "OFFCHAIN").toUpperCase();
  if (mode === "OFFCHAIN" || mode === "ONCHAIN") {
    return mode;
  }
  throw new Error(`invalid CLAIM_FINALIZATION_MODE: ${value}`);
}

function envBigInt(name: string, fallback?: bigint): bigint {
  const value = process.env[name];
  if (!value) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing required env: ${name}`);
  }
  try {
    return BigInt(value);
  } catch {
    throw new Error(`invalid bigint env: ${name}`);
  }
}

function envBigIntOptional(name: string): bigint | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  try {
    return BigInt(value);
  } catch {
    throw new Error(`invalid bigint env: ${name}`);
  }
}

export function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseWeightCsv(value: string | undefined): Array<{ validator: Address; weight: bigint }> {
  if (!value) return [];

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [validatorRaw, weightRaw] = entry.split(":");
      if (!validatorRaw || !weightRaw) {
        throw new Error(`invalid VERIFIER_WEIGHT_SNAPSHOT entry: ${entry}`);
      }
      let weight: bigint;
      try {
        weight = BigInt(weightRaw);
      } catch {
        throw new Error(`invalid weight in VERIFIER_WEIGHT_SNAPSHOT: ${entry}`);
      }
      return {
        validator: validatorRaw as Address,
        weight
      };
    });
}

export function loadRuntimeConfig() {
  const chainId = BigInt(env("CHAIN_ID"));
  const rpcUrl = env("RPC_URL");
  const signerKey = envOptional("RELAYER_SIGNER_PRIVATE_KEY") as Hex | undefined;
  const intentBookAddress = env("INTENT_BOOK_ADDRESS") as Address;
  const clawVaultAddress = env("CLAW_VAULT_ADDRESS") as Address;

  return {
    chainId,
    rpcUrl,
    signerKey,
    intentBookAddress,
    clawVaultAddress,
    claimThresholdWeight:
      envBigIntOptional("CLAIM_THRESHOLD_WEIGHT") ??
      envBigIntOptional("VERIFIER_THRESHOLD_WEIGHT") ??
      BigInt(3),
    intentThresholdWeight: envBigInt("INTENT_THRESHOLD_WEIGHT", BigInt(5)),
    maxSubmitRetries: envNumber("MAX_SUBMIT_RETRIES", 3),
    allowlist: new Set(parseCsv(process.env.VERIFIER_ALLOWLIST).map((v) => v.toLowerCase())),
    validatorWeights: parseWeightCsv(process.env.VERIFIER_WEIGHT_SNAPSHOT)
  };
}

export function loadReadOnlyRuntimeConfig() {
  return {
    claimThresholdWeight:
      envBigIntOptional("CLAIM_THRESHOLD_WEIGHT") ??
      envBigIntOptional("VERIFIER_THRESHOLD_WEIGHT") ??
      BigInt(3),
    intentThresholdWeight: envBigInt("INTENT_THRESHOLD_WEIGHT", BigInt(5)),
    validatorWeights: parseWeightCsv(process.env.VERIFIER_WEIGHT_SNAPSHOT)
  };
}

export function loadFactoryRuntimeConfig() {
  const chainId = BigInt(env("CHAIN_ID"));
  const rpcUrl = env("RPC_URL");
  const signerKey =
    (envOptional("FACTORY_SIGNER_PRIVATE_KEY") ??
      envOptional("RELAYER_SIGNER_PRIVATE_KEY")) as Hex | undefined;
  if (!signerKey) {
    throw new Error("missing required env: FACTORY_SIGNER_PRIVATE_KEY");
  }
  const factoryAddress = env("CLAW_FUND_FACTORY_ADDRESS") as Address;

  return {
    chainId,
    rpcUrl,
    signerKey,
    factoryAddress
  };
}

export function loadChainReadConfig() {
  const chainId = BigInt(env("CHAIN_ID"));
  const rpcUrl = env("RPC_URL");
  const factoryAddress = env("CLAW_FUND_FACTORY_ADDRESS") as Address;

  return {
    chainId,
    rpcUrl,
    factoryAddress
  };
}

export function loadExecutionConfig() {
  const chainId = BigInt(env("CHAIN_ID"));
  const rpcUrl = env("RPC_URL");
  const coreAddress = env("CLAW_CORE_ADDRESS") as Address;
  const signerKey = envOptional("EXECUTOR_PRIVATE_KEY") as Hex | undefined;
  if (!signerKey) {
    throw new Error("missing required env: EXECUTOR_PRIVATE_KEY");
  }

  return {
    chainId,
    rpcUrl,
    coreAddress,
    signerKey,
    batchLimit: envNumber("EXECUTION_BATCH_LIMIT", 5),
    maxAttempts: envNumber("EXECUTION_MAX_ATTEMPTS", 5),
    cronSecret: envOptional("CRON_SECRET")
  };
}
