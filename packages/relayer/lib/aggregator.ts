import {
  reachedWeightedThreshold,
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
  upsertSubjectState
} from "@/lib/supabase";
import { loadRuntimeConfig } from "@/lib/config";
import {
  loadIntentValidatorSnapshot,
  verifierWeight
} from "@/lib/validator-snapshot";

interface IntentInput {
  fundId: string;
  intentHash: Hex;
  verifier: Address;
  expiresAt: bigint;
  nonce: bigint;
  signature: Hex;
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

async function maybeFinalizeIntent(
  fundId: string,
  intentHash: Hex
): Promise<{
  finalized: boolean;
  readyForOnchain?: boolean;
  txHash?: Hex;
  error?: string;
}> {
  const state = await getSubjectStateByFund(fundId, "INTENT", intentHash);
  if (!state) return { finalized: false };
  if (state.status === "APPROVED") {
    return {
      finalized: true,
      txHash: state.tx_hash ? (state.tx_hash as Hex) : undefined
    };
  }

  const rows = await listPendingAttestations("INTENT", intentHash, fundId);
  if (rows.length === 0) return { finalized: false };

  const snapshot = await loadIntentValidatorSnapshot(fundId);
  const verifiers = rows.map((row) => row.verifier as Address);
  if (!reachedWeightedThreshold(verifiers, snapshot.weightMap, snapshot.thresholdWeight)) {
    return { finalized: false };
  }

  incCounter("threshold_met");

  try {
    await markIntentReadyForOnchain({
      fundId,
      intentHash
    });
    return {
      finalized: false,
      readyForOnchain: true
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      finalized: false,
      error: message
    };
  }
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
  const submit = await maybeFinalizeIntent(input.fundId, input.intentHash);

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
      submitted: submit.finalized,
      readyForOnchain: submit.readyForOnchain ?? false,
      txHash: submit.txHash,
      submitError: submit.error
    }
  };
}
