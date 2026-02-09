import { hashTypedData, recoverTypedDataAddress, verifyTypedData } from "viem";
import type { Address, Eip712DomainInput, Hex } from "./types.js";

export const CLAIM_ATTESTATION_TYPES = {
  ClaimAttestation: [
    { name: "claimHash", type: "bytes32" },
    { name: "epochId", type: "uint64" },
    { name: "verifier", type: "address" },
    { name: "expiresAt", type: "uint64" },
    { name: "nonce", type: "uint256" }
  ]
} as const;

export const INTENT_ATTESTATION_TYPES = {
  IntentAttestation: [
    { name: "intentHash", type: "bytes32" },
    { name: "verifier", type: "address" },
    { name: "expiresAt", type: "uint64" },
    { name: "nonce", type: "uint256" }
  ]
} as const;

export interface ClaimAttestationMessage {
  claimHash: Hex;
  epochId: bigint;
  verifier: Address;
  expiresAt: bigint;
  nonce: bigint;
}

export interface IntentAttestationMessage {
  intentHash: Hex;
  verifier: Address;
  expiresAt: bigint;
  nonce: bigint;
}

export function toEip712Domain(input: Eip712DomainInput) {
  return {
    name: input.name,
    version: input.version,
    chainId: input.chainId,
    verifyingContract: input.verifyingContract
  };
}

export function claimAttestationTypedData(
  domain: Eip712DomainInput,
  message: ClaimAttestationMessage
) {
  return {
    domain: toEip712Domain(domain),
    types: CLAIM_ATTESTATION_TYPES,
    primaryType: "ClaimAttestation" as const,
    message
  };
}

export function intentAttestationTypedData(
  domain: Eip712DomainInput,
  message: IntentAttestationMessage
) {
  return {
    domain: toEip712Domain(domain),
    types: INTENT_ATTESTATION_TYPES,
    primaryType: "IntentAttestation" as const,
    message
  };
}

export function claimAttestationDigest(
  domain: Eip712DomainInput,
  message: ClaimAttestationMessage
): Hex {
  return hashTypedData(claimAttestationTypedData(domain, message));
}

export function intentAttestationDigest(
  domain: Eip712DomainInput,
  message: IntentAttestationMessage
): Hex {
  return hashTypedData(intentAttestationTypedData(domain, message));
}

export async function verifyClaimAttestation(
  domain: Eip712DomainInput,
  message: ClaimAttestationMessage,
  signature: Hex
): Promise<boolean> {
  return verifyTypedData({
    ...claimAttestationTypedData(domain, message),
    address: message.verifier,
    signature
  });
}

export async function verifyIntentAttestation(
  domain: Eip712DomainInput,
  message: IntentAttestationMessage,
  signature: Hex
): Promise<boolean> {
  return verifyTypedData({
    ...intentAttestationTypedData(domain, message),
    address: message.verifier,
    signature
  });
}

export async function recoverClaimAttester(
  domain: Eip712DomainInput,
  message: ClaimAttestationMessage,
  signature: Hex
): Promise<Address> {
  return recoverTypedDataAddress({
    ...claimAttestationTypedData(domain, message),
    signature
  });
}

export async function recoverIntentAttester(
  domain: Eip712DomainInput,
  message: IntentAttestationMessage,
  signature: Hex
): Promise<Address> {
  return recoverTypedDataAddress({
    ...intentAttestationTypedData(domain, message),
    signature
  });
}
