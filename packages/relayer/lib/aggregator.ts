import {
  reachedWeightedThreshold,
  verifyClaimAttestationEnvelope,
  verifyIntentAttestationEnvelope,
  type Address,
  type Eip712DomainInput,
  type Hex
} from "@claw/protocol-sdk";
import { relayerEvents } from "@/lib/event-emitter";
import { incCounter } from "@/lib/metrics";
import {
  getSubjectStateByFund,
  incrementSubjectAttestedWeight,
  insertAttestation,
  listPendingAttestations,
  markIntentReadyForOnchain,
  markSubjectApproved,
  upsertSubjectState,
  type SubjectType
} from "@/lib/supabase";
import { loadRuntimeConfig, type ClaimFinalizationMode } from "@/lib/config";
import {
  loadClaimValidatorSnapshot,
  loadIntentValidatorSnapshot,
  verifierWeight
} from "@/lib/validator-snapshot";

interface ClaimInput {
  fundId: string;
  claimHash: Hex;
  epochId: bigint;
  verifier: Address;
  expiresAt: bigint;
  nonce: bigint;
  signature: Hex;
}

interface IntentInput {
  fundId: string;
  intentHash: Hex;
  verifier: Address;
  expiresAt: bigint;
  nonce: bigint;
  signature: Hex;
}

function claimDomain(): Eip712DomainInput {
  const cfg = loadRuntimeConfig();
  return {
    name: "ClawClaimBook",
    version: "1",
    chainId: cfg.chainId,
    verifyingContract: cfg.claimAttestationVerifierAddress
  };
}

function intentDomain(): Eip712DomainInput {
  const cfg = loadRuntimeConfig();
  return {
    name: "ClawIntentBook",
    version: "1",
    chainId: cfg.chainId,
    verifyingContract: cfg.intentBookAddress
  };
}

function isVerifierAllowed(verifier: Address): boolean {
  const { allowlist } = loadRuntimeConfig();
  if (allowlist.size === 0) return true;
  return allowlist.has(verifier.toLowerCase());
}

async function maybeFinalizeSubject(
  fundId: string,
  subjectType: SubjectType,
  subjectHash: Hex
): Promise<{
  finalized: boolean;
  finalizationMode: ClaimFinalizationMode;
  readyForOnchain?: boolean;
  txHash?: Hex;
  error?: string;
}> {
  const cfg = loadRuntimeConfig();
  const finalizationMode =
    subjectType === "CLAIM" ? cfg.claimFinalizationMode : ("ONCHAIN" as const);
  const state = await getSubjectStateByFund(fundId, subjectType, subjectHash);
  if (!state) return { finalized: false, finalizationMode };
  if (state.status === "APPROVED") {
    const approvedMode: ClaimFinalizationMode =
      subjectType === "CLAIM" ? (state.tx_hash ? "ONCHAIN" : "OFFCHAIN") : "ONCHAIN";
    return {
      finalized: true,
      finalizationMode: approvedMode,
      txHash: state.tx_hash ? (state.tx_hash as Hex) : undefined
    };
  }

  const rows = await listPendingAttestations(subjectType, subjectHash, fundId);
  if (rows.length === 0) return { finalized: false, finalizationMode };

  const snapshot =
    subjectType === "CLAIM"
      ? await loadClaimValidatorSnapshot(fundId, BigInt(rows[0].epoch_id ?? "0"))
      : await loadIntentValidatorSnapshot(fundId);

  const verifiers = rows.map((row) => row.verifier as Address);
  if (!reachedWeightedThreshold(verifiers, snapshot.weightMap, snapshot.thresholdWeight)) {
    return { finalized: false, finalizationMode };
  }

  incCounter("threshold_met");

  if (subjectType === "CLAIM" && cfg.claimFinalizationMode === "OFFCHAIN") {
    await markSubjectApproved({
      fundId,
      subjectType,
      subjectHash
    });
    return {
      finalized: true,
      finalizationMode: "OFFCHAIN"
    };
  }

  // Keyless relayer policy:
  // - CLAIM in ONCHAIN mode: unsupported (no relayer signer), keep pending with explicit error.
  // - INTENT: mark READY_FOR_ONCHAIN so strategy AA submits onchain attest/execute.
  if (subjectType === "CLAIM") {
    const message =
      "CLAIM_FINALIZATION_MODE=ONCHAIN is not supported in keyless relayer mode; use OFFCHAIN.";
    return {
      finalized: false,
      finalizationMode: "ONCHAIN",
      error: message
    };
  }

  try {
    await markIntentReadyForOnchain({
      fundId,
      intentHash: subjectHash
    });
    return {
      finalized: false,
      finalizationMode: "ONCHAIN",
      readyForOnchain: true
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      finalized: false,
      finalizationMode: "ONCHAIN",
      error: message
    };
  }
}

export async function ingestClaimAttestation(input: ClaimInput) {
  incCounter("requests_total");
  incCounter("requests_claim_attest");

  if (!isVerifierAllowed(input.verifier)) {
    return { ok: false as const, status: 403, error: "verifier not allowlisted" };
  }

  const verification = await verifyClaimAttestationEnvelope(
    claimDomain(),
    {
      claimHash: input.claimHash,
      epochId: input.epochId,
      verifier: input.verifier,
      expiresAt: input.expiresAt,
      nonce: input.nonce
    },
    input.signature
  );

  if (!verification.ok) {
    incCounter("verify_fail");
    return {
      ok: false as const,
      status: 400,
      error: verification.error ?? "attestation verification failed"
    };
  }

  const snapshot = await loadClaimValidatorSnapshot(input.fundId, input.epochId);
  const weight = verifierWeight(snapshot, input.verifier);
  if (weight <= BigInt(0)) {
    return { ok: false as const, status: 403, error: "verifier is not in validator snapshot" };
  }

  await upsertSubjectState({
    fundId: input.fundId,
    subjectType: "CLAIM",
    subjectHash: input.claimHash,
    epochId: input.epochId,
    thresholdWeight: snapshot.thresholdWeight
  });
  const stateBeforeInsert = await getSubjectStateByFund(input.fundId, "CLAIM", input.claimHash);
  const alreadyApproved = stateBeforeInsert?.status === "APPROVED";

  const inserted = await insertAttestation({
    fundId: input.fundId,
    subjectType: "CLAIM",
    subjectHash: input.claimHash,
    epochId: input.epochId,
    verifier: input.verifier,
    expiresAt: input.expiresAt,
    nonce: input.nonce,
    signature: input.signature,
    status: alreadyApproved ? "APPROVED" : "PENDING",
    txHash: stateBeforeInsert?.tx_hash
  });

  if (!inserted.ok) {
    incCounter("duplicate_rejected");
    return {
      ok: false as const,
      status: 409,
      error: "duplicate attestation"
    };
  }

  incCounter("verify_success");
  if (alreadyApproved) {
    const txHash = stateBeforeInsert?.tx_hash ? (stateBeforeInsert.tx_hash as Hex) : undefined;
    const attestedWeight = stateBeforeInsert?.attested_weight ?? "0";
    relayerEvents.emitEvent("claim:attested", {
      fundId: input.fundId,
      claimHash: input.claimHash,
      verifier: input.verifier,
      weight: weight.toString(),
      attestedWeight,
      thresholdWeight: snapshot.thresholdWeight.toString()
    });
    return {
      ok: true as const,
      status: 200,
      data: {
        subjectType: "CLAIM",
        subjectHash: input.claimHash,
        digest: verification.digest,
        attestedWeight,
        thresholdWeight: snapshot.thresholdWeight.toString(),
        totalWeight: snapshot.totalWeight.toString(),
        validatorSnapshotId: snapshot.snapshotId,
        finalized: true,
        finalizationMode: txHash ? ("ONCHAIN" as const) : ("OFFCHAIN" as const),
        submitted: true,
        txHash
      }
    };
  }

  const attestedWeight = await incrementSubjectAttestedWeight("CLAIM", input.claimHash, weight);

  relayerEvents.emitEvent("claim:attested", {
    fundId: input.fundId,
    claimHash: input.claimHash,
    verifier: input.verifier,
    weight: weight.toString(),
    attestedWeight: attestedWeight.toString(),
    thresholdWeight: snapshot.thresholdWeight.toString()
  });
  const submit = await maybeFinalizeSubject(input.fundId, "CLAIM", input.claimHash);

  if (submit.finalized) {
    relayerEvents.emitEvent("snapshot:finalized", {
      fundId: input.fundId,
      claimHash: input.claimHash,
      txHash: submit.txHash ?? null,
      finalizationMode: submit.finalizationMode
    });
  }

  return {
    ok: true as const,
    status: submit.finalized ? 200 : 202,
    data: {
      subjectType: "CLAIM",
      subjectHash: input.claimHash,
      digest: verification.digest,
      attestedWeight: attestedWeight.toString(),
      thresholdWeight: snapshot.thresholdWeight.toString(),
      totalWeight: snapshot.totalWeight.toString(),
      validatorSnapshotId: snapshot.snapshotId,
      finalized: submit.finalized,
      finalizationMode: submit.finalizationMode,
      submitted: submit.finalized,
      readyForOnchain: submit.readyForOnchain ?? false,
      txHash: submit.txHash,
      submitError: submit.error
    }
  };
}

export async function ingestIntentAttestation(input: IntentInput) {
  incCounter("requests_total");
  incCounter("requests_intent_attest");

  if (!isVerifierAllowed(input.verifier)) {
    return { ok: false as const, status: 403, error: "verifier not allowlisted" };
  }

  const verification = await verifyIntentAttestationEnvelope(
    intentDomain(),
    {
      intentHash: input.intentHash,
      verifier: input.verifier,
      expiresAt: input.expiresAt,
      nonce: input.nonce
    },
    input.signature
  );

  if (!verification.ok) {
    incCounter("verify_fail");
    return {
      ok: false as const,
      status: 400,
      error: verification.error ?? "attestation verification failed"
    };
  }

  const snapshot = await loadIntentValidatorSnapshot(input.fundId);
  const weight = verifierWeight(snapshot, input.verifier);
  if (weight <= BigInt(0)) {
    return { ok: false as const, status: 403, error: "verifier is not in validator snapshot" };
  }

  await upsertSubjectState({
    fundId: input.fundId,
    subjectType: "INTENT",
    subjectHash: input.intentHash,
    epochId: null,
    thresholdWeight: snapshot.thresholdWeight
  });
  const stateBeforeInsert = await getSubjectStateByFund(input.fundId, "INTENT", input.intentHash);
  const alreadyApproved = stateBeforeInsert?.status === "APPROVED";

  const inserted = await insertAttestation({
    fundId: input.fundId,
    subjectType: "INTENT",
    subjectHash: input.intentHash,
    epochId: null,
    verifier: input.verifier,
    expiresAt: input.expiresAt,
    nonce: input.nonce,
    signature: input.signature,
    status: alreadyApproved ? "APPROVED" : "PENDING",
    txHash: stateBeforeInsert?.tx_hash
  });

  if (!inserted.ok) {
    incCounter("duplicate_rejected");
    return {
      ok: false as const,
      status: 409,
      error: "duplicate attestation"
    };
  }

  incCounter("verify_success");
  if (alreadyApproved) {
    const txHash = stateBeforeInsert?.tx_hash ? (stateBeforeInsert.tx_hash as Hex) : undefined;
    const attestedWeight = stateBeforeInsert?.attested_weight ?? "0";
    relayerEvents.emitEvent("intent:attested", {
      fundId: input.fundId,
      intentHash: input.intentHash,
      verifier: input.verifier,
      weight: weight.toString(),
      attestedWeight,
      thresholdWeight: snapshot.thresholdWeight.toString()
    });
    return {
      ok: true as const,
      status: 200,
      data: {
        subjectType: "INTENT",
        subjectHash: input.intentHash,
        digest: verification.digest,
        attestedWeight,
        thresholdWeight: snapshot.thresholdWeight.toString(),
        totalWeight: snapshot.totalWeight.toString(),
        validatorSnapshotId: snapshot.snapshotId,
        finalized: true,
        finalizationMode: "ONCHAIN" as const,
        submitted: true,
        txHash
      }
    };
  }

  const attestedWeight = await incrementSubjectAttestedWeight("INTENT", input.intentHash, weight);

  relayerEvents.emitEvent("intent:attested", {
    fundId: input.fundId,
    intentHash: input.intentHash,
    verifier: input.verifier,
    weight: weight.toString(),
    attestedWeight: attestedWeight.toString(),
    thresholdWeight: snapshot.thresholdWeight.toString()
  });
  const submit = await maybeFinalizeSubject(input.fundId, "INTENT", input.intentHash);

  return {
    ok: true as const,
    status: submit.finalized ? 200 : 202,
    data: {
      subjectType: "INTENT",
      subjectHash: input.intentHash,
      digest: verification.digest,
      attestedWeight: attestedWeight.toString(),
      thresholdWeight: snapshot.thresholdWeight.toString(),
      totalWeight: snapshot.totalWeight.toString(),
      validatorSnapshotId: snapshot.snapshotId,
      finalized: submit.finalized,
      finalizationMode: submit.finalizationMode,
      submitted: submit.finalized,
      readyForOnchain: submit.readyForOnchain ?? false,
      txHash: submit.txHash,
      submitError: submit.error
    }
  };
}
