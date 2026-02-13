import {
  buildValidatorWeightMap,
  totalValidatorWeight,
  type Address,
  type ValidatorWeight
} from "@claw/protocol-sdk";
import { loadRuntimeConfig } from "@/lib/config";
import { getFundThresholds } from "@/lib/sqlite";

export interface ValidatorSnapshot {
  snapshotId: string;
  thresholdWeight: bigint;
  totalWeight: bigint;
  weightMap: Map<string, bigint>;
}

function snapshotFromConfig(snapshotId: string, thresholdWeight: bigint): ValidatorSnapshot {
  const cfg = loadRuntimeConfig();
  const entries = cfg.validatorWeights as ValidatorWeight[];
  if (entries.length === 0) {
    throw new Error("VERIFIER_WEIGHT_SNAPSHOT is required for weighted attestation mode");
  }

  const weightMap = buildValidatorWeightMap(entries);
  const totalWeight = totalValidatorWeight(weightMap);

  if (thresholdWeight > totalWeight) {
    throw new Error(
      `thresholdWeight exceeds snapshot totalWeight (${thresholdWeight.toString()} > ${totalWeight.toString()})`
    );
  }

  return {
    snapshotId,
    thresholdWeight,
    totalWeight,
    weightMap
  };
}

export function loadClaimValidatorSnapshot(fundId: string, epochId: bigint): ValidatorSnapshot {
  const cfg = loadRuntimeConfig();
  const fund = getFundThresholds(fundId);
  const thresholdWeight = fund?.claimThresholdWeight ?? cfg.claimThresholdWeight;
  // TODO: replace config-backed snapshot with onchain snapshot reader once registry ABI is finalized.
  return snapshotFromConfig(`${fundId}:${epochId.toString()}:claim`, thresholdWeight);
}

export function loadIntentValidatorSnapshot(fundId: string): ValidatorSnapshot {
  const cfg = loadRuntimeConfig();
  const fund = getFundThresholds(fundId);
  const thresholdWeight = fund?.intentThresholdWeight ?? cfg.intentThresholdWeight;
  // TODO: replace config-backed snapshot with onchain snapshot reader once registry ABI is finalized.
  return snapshotFromConfig(`${fundId}:intent`, thresholdWeight);
}

export function verifierWeight(snapshot: ValidatorSnapshot, verifier: Address): bigint {
  return snapshot.weightMap.get(verifier.toLowerCase()) ?? BigInt(0);
}
