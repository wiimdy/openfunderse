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
  getSubjectState,
  incrementSubjectAttestedWeight,
  insertAttestation,
  listPendingAttestations,
  markSubjectApproved,
  markSubjectSubmitError,
  upsertSubjectState,
  type SubjectType
} from "@/lib/sqlite";
import { loadRuntimeConfig } from "@/lib/config";
import { submitClaimAttestationsOnchain, submitIntentAttestationsOnchain } from "@/lib/onchain";
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
    verifyingContract: cfg.claimBookAddress
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

async function maybeSubmitOnchain(subjectType: SubjectType, subjectHash: Hex): Promise<{
  submitted: boolean;
  txHash?: Hex;
  error?: string;
}> {
  const state = getSubjectState(subjectType, subjectHash);
  if (!state) return { submitted: false };
  if (state.status === "APPROVED") return { submitted: false };

  const rows = listPendingAttestations(subjectType, subjectHash);
  if (rows.length === 0) return { submitted: false };

  const fundId = rows[0]?.fund_id;
  if (!fundId) return { submitted: false };

  const snapshot =
    subjectType === "CLAIM"
      ? loadClaimValidatorSnapshot(fundId, BigInt(rows[0].epoch_id ?? "0"))
      : loadIntentValidatorSnapshot(fundId);

  const verifiers = rows.map((row) => row.verifier as Address);
  if (!reachedWeightedThreshold(verifiers, snapshot.weightMap, snapshot.thresholdWeight)) {
    return { submitted: false };
  }

  const signatures = rows.map((row) => row.signature as Hex);

  incCounter("threshold_met");

  try {
    const txHash =
      subjectType === "CLAIM"
        ? await submitClaimAttestationsOnchain({
            claimHash: subjectHash,
            verifiers,
            signatures
          })
        : await submitIntentAttestationsOnchain({
            intentHash: subjectHash,
            verifiers,
            signatures
          });

    markSubjectApproved({
      subjectType,
      subjectHash,
      txHash
    });

    incCounter("onchain_submit_success");

    return {
      submitted: true,
      txHash
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    markSubjectSubmitError({
      subjectType,
      subjectHash,
      message
    });
    incCounter("onchain_submit_fail");

    return {
      submitted: false,
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

  const snapshot = loadClaimValidatorSnapshot(input.fundId, input.epochId);
  const weight = verifierWeight(snapshot, input.verifier);
  if (weight <= BigInt(0)) {
    return { ok: false as const, status: 403, error: "verifier is not in validator snapshot" };
  }

  upsertSubjectState({
    fundId: input.fundId,
    subjectType: "CLAIM",
    subjectHash: input.claimHash,
    epochId: input.epochId,
    thresholdWeight: snapshot.thresholdWeight
  });

  const inserted = insertAttestation({
    fundId: input.fundId,
    subjectType: "CLAIM",
    subjectHash: input.claimHash,
    epochId: input.epochId,
    verifier: input.verifier,
    expiresAt: input.expiresAt,
    nonce: input.nonce,
    signature: input.signature
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
  const attestedWeight = incrementSubjectAttestedWeight("CLAIM", input.claimHash, weight);

  relayerEvents.emitEvent("claim:attested", {
    fundId: input.fundId,
    claimHash: input.claimHash,
    verifier: input.verifier,
    weight: weight.toString(),
    attestedWeight: attestedWeight.toString(),
    thresholdWeight: snapshot.thresholdWeight.toString()
  });

  const submit = await maybeSubmitOnchain("CLAIM", input.claimHash);

  if (submit.submitted) {
    relayerEvents.emitEvent("snapshot:finalized", {
      fundId: input.fundId,
      claimHash: input.claimHash,
      txHash: submit.txHash
    });
  }

  return {
    ok: true as const,
    status: submit.submitted ? 200 : 202,
    data: {
      subjectType: "CLAIM",
      subjectHash: input.claimHash,
      digest: verification.digest,
      attestedWeight: attestedWeight.toString(),
      thresholdWeight: snapshot.thresholdWeight.toString(),
      totalWeight: snapshot.totalWeight.toString(),
      validatorSnapshotId: snapshot.snapshotId,
      submitted: submit.submitted,
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

  const snapshot = loadIntentValidatorSnapshot(input.fundId);
  const weight = verifierWeight(snapshot, input.verifier);
  if (weight <= BigInt(0)) {
    return { ok: false as const, status: 403, error: "verifier is not in validator snapshot" };
  }

  upsertSubjectState({
    fundId: input.fundId,
    subjectType: "INTENT",
    subjectHash: input.intentHash,
    epochId: null,
    thresholdWeight: snapshot.thresholdWeight
  });

  const inserted = insertAttestation({
    fundId: input.fundId,
    subjectType: "INTENT",
    subjectHash: input.intentHash,
    epochId: null,
    verifier: input.verifier,
    expiresAt: input.expiresAt,
    nonce: input.nonce,
    signature: input.signature
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
  const attestedWeight = incrementSubjectAttestedWeight("INTENT", input.intentHash, weight);

  relayerEvents.emitEvent("intent:attested", {
    fundId: input.fundId,
    intentHash: input.intentHash,
    verifier: input.verifier,
    weight: weight.toString(),
    attestedWeight: attestedWeight.toString(),
    thresholdWeight: snapshot.thresholdWeight.toString()
  });

  const submit = await maybeSubmitOnchain("INTENT", input.intentHash);

  return {
    ok: true as const,
    status: submit.submitted ? 200 : 202,
    data: {
      subjectType: "INTENT",
      subjectHash: input.intentHash,
      digest: verification.digest,
      attestedWeight: attestedWeight.toString(),
      thresholdWeight: snapshot.thresholdWeight.toString(),
      totalWeight: snapshot.totalWeight.toString(),
      validatorSnapshotId: snapshot.snapshotId,
      submitted: submit.submitted,
      txHash: submit.txHash,
      submitError: submit.error
    }
  };
}
