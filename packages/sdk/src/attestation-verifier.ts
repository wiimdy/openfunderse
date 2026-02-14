import {
  intentAttestationDigest,
  recoverIntentAttester,
  type IntentAttestationMessage
} from "./eip712.js";
import { assertNotExpired } from "./attestation.js";
import type { Eip712DomainInput, Hex } from "./types.js";

export interface VerificationResult {
  ok: boolean;
  digest?: Hex;
  recovered?: `0x${string}`;
  error?: string;
}

async function verifyEnvelope(
  verifier: `0x${string}`,
  computeDigest: () => Hex,
  recoverAddress: () => Promise<`0x${string}`>
): Promise<VerificationResult> {
  try {
    const digest = computeDigest();
    const recovered = await recoverAddress();

    if (recovered.toLowerCase() !== verifier.toLowerCase()) {
      return {
        ok: false,
        digest,
        recovered,
        error: "signature does not recover claimed verifier"
      };
    }

    return {
      ok: true,
      digest,
      recovered
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function verifyIntentAttestationEnvelope(
  domain: Eip712DomainInput,
  message: IntentAttestationMessage,
  signature: Hex
): Promise<VerificationResult> {
  try {
    assertNotExpired(message.expiresAt);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }

  return verifyEnvelope(
    message.verifier,
    () => intentAttestationDigest(domain, message),
    () => recoverIntentAttester(domain, message, signature)
  );
}

export function reachedThreshold(validCount: number, threshold: number): boolean {
  if (!Number.isInteger(validCount) || validCount < 0) {
    throw new Error("validCount must be a non-negative integer");
  }
  if (!Number.isInteger(threshold) || threshold <= 0) {
    throw new Error("threshold must be a positive integer");
  }
  return validCount >= threshold;
}
