import type { Address, Hex } from "@claw/protocol-sdk";

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
  const signerKey = env("RELAYER_SIGNER_PRIVATE_KEY") as Hex;
  const intentBookAddress = env("INTENT_BOOK_ADDRESS") as Address;

  return {
    chainId,
    rpcUrl,
    signerKey,
    intentBookAddress,
    intentThresholdWeight: envBigInt("INTENT_THRESHOLD_WEIGHT", BigInt(5)),
    maxSubmitRetries: envNumber("MAX_SUBMIT_RETRIES", 3),
    allowlist: new Set(parseCsv(process.env.VERIFIER_ALLOWLIST).map((v) => v.toLowerCase())),
    validatorWeights: parseWeightCsv(process.env.VERIFIER_WEIGHT_SNAPSHOT)
  };
}

export function loadReadOnlyRuntimeConfig() {
  return {
    intentThresholdWeight: envBigInt("INTENT_THRESHOLD_WEIGHT", BigInt(5)),
    validatorWeights: parseWeightCsv(process.env.VERIFIER_WEIGHT_SNAPSHOT)
  };
}

export function relayerDbPath(): string {
  return process.env.RELAYER_DB_PATH ?? "./data/relayer.db";
}
