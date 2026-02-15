import {
  buildCanonicalAllocationClaimRecord,
  type Address,
  type AllocationClaimV1
} from '@claw/protocol-sdk';
import {
  createRelayerClient,
  type RelayerClientOptions
} from '../../lib/relayer-client.js';
import { isAddress } from 'viem';

export interface ProposeAllocationInput {
  taskType: 'propose_allocation';
  fundId: string;
  roomId: string;
  epochId: number;
  allocation: {
    participant?: string;
    targetWeights: Array<string | number | bigint>;
    horizonSec?: number;
    nonce?: number;
  };
}

export interface SerializedAllocationClaimV1 {
  claimVersion: 'v1';
  fundId: string;
  epochId: string;
  participant: Address;
  targetWeights: string[];
  horizonSec: string;
  nonce: string;
  submittedAt: string;
}

export interface ProposeAllocationObservation {
  claimHash: string;
  participant: Address;
  targetWeights: string[];
  horizonSec: string;
  nonce: string;
  submittedAt: string;
  canonicalClaim: SerializedAllocationClaimV1;
}

export interface ProposeAllocationOutput {
  status: 'OK' | 'ERROR';
  taskType: 'propose_allocation';
  fundId: string;
  epochId: number;
  observation?: ProposeAllocationObservation;
  confidence: number;
  assumptions: string[];
  reasonCode?: string;
  error?: string;
}

export interface ValidateAllocationOrIntentInput {
  taskType: 'validate_allocation_or_intent';
  fundId: string;
  roomId: string;
  epochId: number;
  subjectType: 'CLAIM' | 'INTENT';
  subjectHash: string;
  subjectPayload: Record<string, unknown>;
  validationPolicy: {
    reproducible: boolean;
    maxDataAgeSeconds: number;
  };
}

export interface ValidateAllocationOrIntentOutput {
  status: 'OK' | 'ERROR';
  taskType: 'validate_allocation_or_intent';
  fundId: string;
  roomId: string;
  epochId: number;
  subjectType: 'CLAIM' | 'INTENT';
  subjectHash: string;
  verdict: 'PASS' | 'FAIL' | 'NEED_MORE_EVIDENCE';
  reason: string;
  reasonCode:
    | 'OK'
    | 'MISSING_FIELDS'
    | 'INVALID_SCOPE'
    | 'STALE_DATA'
    | 'REPRODUCTION_FAILED'
    | 'HASH_MISMATCH';
  confidence: number;
  assumptions: string[];
  error?: string;
}

export interface SubmitAllocationInput {
  fundId: string;
  epochId: number;
  observation: ProposeAllocationObservation;
  clientOptions?: RelayerClientOptions;
  submit?: boolean;
  // When true, never submit even if auto-submit is enabled (used for explicit dry-runs).
  disableAutoSubmit?: boolean;
}

export interface SubmitAllocationOutput {
  status: 'OK' | 'ERROR';
  fundId: string;
  epochId: number;
  decision?: 'READY' | 'SUBMITTED';
  claimHash?: string;
  response?: Record<string, unknown>;
  reasonCode?:
    | 'OK'
    | 'CLAIM_HASH_MISMATCH'
    | 'SAFETY_BLOCKED'
    | 'RELAYER_REJECTED'
    | 'NETWORK_ERROR';
  error?: string;
  safety?: {
    submitRequested: boolean;
    autoSubmitEnabled: boolean;
    requireExplicitSubmit: boolean;
    trustedRelayerHosts: string[];
  };
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;
// Defaults: allow unattended submission unless explicitly disabled via env / CLI.
const DEFAULT_REQUIRE_EXPLICIT_SUBMIT = false;
const DEFAULT_AUTO_SUBMIT = true;
const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\.0\.0\.0$/,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^::1$/i,
  /^fc/i,
  /^fd/i,
  /^fe80:/i
];

const parseEnvCsv = (value: string | undefined): string[] => {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
};

const envBool = (name: string, fallback: boolean): boolean => {
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const isPrivateHostname = (hostname: string): boolean => {
  const host = hostname.trim().toLowerCase();
  if (host.endsWith('.local')) return true;
  return PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(host));
};

const trustedRelayerHosts = (): string[] => {
  return parseEnvCsv(process.env.PARTICIPANT_TRUSTED_RELAYER_HOSTS);
};

const validateParticipantRelayerUrl = (rawUrl: string, hosts: string[]): void => {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`RELAYER_URL is invalid: ${rawUrl}`);
  }

  const allowHttp = envBool('PARTICIPANT_ALLOW_HTTP_RELAYER', false);
  if (parsed.protocol !== 'https:' && !(allowHttp && parsed.protocol === 'http:')) {
    throw new Error(
      'RELAYER_URL must use https (set PARTICIPANT_ALLOW_HTTP_RELAYER=true only for local development)'
    );
  }

  const host = parsed.hostname.trim().toLowerCase();
  if (hosts.length > 0 && !hosts.includes(host)) {
    throw new Error(
      `RELAYER_URL host is not in PARTICIPANT_TRUSTED_RELAYER_HOSTS: host=${host}`
    );
  }

  if (hosts.length === 0 && isPrivateHostname(host) && parsed.protocol === 'https:') {
    throw new Error(
      'RELAYER_URL points to a private/local host over https. Configure PARTICIPANT_TRUSTED_RELAYER_HOSTS explicitly.'
    );
  }
};

const participantSubmitSafety = (
  submitRequested: boolean,
  disableAutoSubmit: boolean
): {
  submitRequested: boolean;
  autoSubmitEnabled: boolean;
  requireExplicitSubmit: boolean;
  trustedRelayerHosts: string[];
  disableAutoSubmit: boolean;
  shouldSubmit: boolean;
} => {
  const requireExplicitSubmit = envBool(
    'PARTICIPANT_REQUIRE_EXPLICIT_SUBMIT',
    DEFAULT_REQUIRE_EXPLICIT_SUBMIT
  );
  const autoSubmitEnabled = envBool('PARTICIPANT_AUTO_SUBMIT', DEFAULT_AUTO_SUBMIT);
  const hosts = trustedRelayerHosts();
  const shouldSubmit = disableAutoSubmit
    ? submitRequested
    : submitRequested || (!requireExplicitSubmit && autoSubmitEnabled);
  return {
    submitRequested,
    autoSubmitEnabled,
    requireExplicitSubmit,
    trustedRelayerHosts: hosts,
    disableAutoSubmit,
    shouldSubmit
  };
};

const toAddress = (value: string): Address => {
  if (!isAddress(value)) {
    throw new Error(`invalid participant address: ${value}`);
  }
  return value as Address;
};

const participantAddressFromEnv = (override?: string): Address => {
  const raw = (
    override ??
    process.env.PARTICIPANT_ADDRESS ??
    process.env.PARTICIPANT_BOT_ADDRESS ??
    ''
  ).trim();
  if (!raw) return ZERO_ADDRESS;
  return toAddress(raw);
};

const normalizeTargetWeights = (
  input: Array<string | number | bigint>
): bigint[] => {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('targetWeights must be a non-empty array');
  }
  const out = input.map((value) => BigInt(value));
  if (out.some((v) => v < 0n)) {
    throw new Error('targetWeights must be non-negative');
  }
  const sum = out.reduce((acc, cur) => acc + cur, 0n);
  if (sum <= 0n) {
    throw new Error('targetWeights sum must be positive');
  }
  return out;
};

const nowSeconds = (): bigint => BigInt(Math.floor(Date.now() / 1000));

const toSerializedClaim = (claim: AllocationClaimV1): SerializedAllocationClaimV1 => ({
  claimVersion: 'v1',
  fundId: claim.fundId,
  epochId: claim.epochId.toString(),
  participant: claim.participant,
  targetWeights: claim.targetWeights.map((v) => v.toString()),
  horizonSec: claim.horizonSec.toString(),
  nonce: claim.nonce.toString(),
  submittedAt: claim.submittedAt.toString()
});

const fromSerializedClaim = (
  claim: SerializedAllocationClaimV1
): AllocationClaimV1 => ({
  claimVersion: 'v1',
  fundId: claim.fundId,
  epochId: BigInt(claim.epochId),
  participant: claim.participant,
  targetWeights: claim.targetWeights.map((v) => BigInt(v)),
  horizonSec: BigInt(claim.horizonSec),
  nonce: BigInt(claim.nonce),
  submittedAt: BigInt(claim.submittedAt)
});

export async function proposeAllocation(
  input: ProposeAllocationInput
): Promise<ProposeAllocationOutput> {
  const { fundId, epochId, allocation } = input;

  try {
    const participant = participantAddressFromEnv(allocation.participant);
    if (participant === ZERO_ADDRESS) {
      throw new Error(
        'participant address is required (PARTICIPANT_ADDRESS or PARTICIPANT_BOT_ADDRESS)'
      );
    }

    const targetWeights = normalizeTargetWeights(allocation.targetWeights);
    const submittedAt = nowSeconds();

    const claim: AllocationClaimV1 = {
      claimVersion: 'v1',
      fundId,
      epochId: BigInt(epochId),
      participant,
      targetWeights,
      horizonSec: BigInt(allocation.horizonSec ?? 3600),
      nonce: BigInt(allocation.nonce ?? submittedAt),
      submittedAt
    };

    const canonical = buildCanonicalAllocationClaimRecord({ claim });

    return {
      status: 'OK',
      taskType: 'propose_allocation',
      fundId,
      epochId,
      observation: {
        claimHash: canonical.claimHash,
        participant,
        targetWeights: targetWeights.map((v) => v.toString()),
        horizonSec: claim.horizonSec.toString(),
        nonce: claim.nonce.toString(),
        submittedAt: claim.submittedAt.toString(),
        canonicalClaim: toSerializedClaim(canonical.claim)
      },
      confidence: 0.95,
      assumptions: ['claim is allocation-only (targetWeights) and does not include crawl/evidence payloads'],
      reasonCode: 'OK'
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: 'ERROR',
      taskType: 'propose_allocation',
      fundId,
      epochId,
      confidence: 0,
      assumptions: [],
      reasonCode: 'MISSING_FIELDS',
      error: message
    };
  }
}

export async function validateAllocationOrIntent(
  input: ValidateAllocationOrIntentInput
): Promise<ValidateAllocationOrIntentOutput> {
  const { fundId, roomId, epochId, subjectType, subjectHash, subjectPayload } = input;

  const base = {
    status: 'OK' as const,
    taskType: 'validate_allocation_or_intent' as const,
    fundId,
    roomId,
    epochId,
    subjectType,
    subjectHash
  };

  if (subjectType === 'CLAIM') {
    const claimVersion = String(subjectPayload.claimVersion ?? '');
    const payloadFundId = String(subjectPayload.fundId ?? '');
    const payloadEpochId = String(subjectPayload.epochId ?? '');
    const participant = String(subjectPayload.participant ?? '');
    const targetWeightsRaw = subjectPayload.targetWeights;

    if (
      claimVersion !== 'v1' ||
      !payloadFundId ||
      !payloadEpochId ||
      !participant ||
      !Array.isArray(targetWeightsRaw) ||
      targetWeightsRaw.length === 0
    ) {
      return {
        ...base,
        verdict: 'NEED_MORE_EVIDENCE',
        reason: 'allocation claim requires claimVersion/fundId/epochId/participant/targetWeights',
        reasonCode: 'MISSING_FIELDS',
        confidence: 0,
        assumptions: []
      };
    }

    if (payloadFundId !== fundId || payloadEpochId !== String(epochId)) {
      return {
        ...base,
        verdict: 'FAIL',
        reason: 'claim scope mismatch with fundId/epochId',
        reasonCode: 'INVALID_SCOPE',
        confidence: 0.9,
        assumptions: []
      };
    }

    if (!isAddress(participant)) {
      return {
        ...base,
        verdict: 'FAIL',
        reason: 'claim participant must be a valid address',
        reasonCode: 'INVALID_SCOPE',
        confidence: 0.9,
        assumptions: []
      };
    }

    try {
      const claim: AllocationClaimV1 = {
        claimVersion: 'v1',
        fundId,
        epochId: BigInt(payloadEpochId),
        participant: participant as Address,
        targetWeights: normalizeTargetWeights(targetWeightsRaw as Array<string | number | bigint>),
        horizonSec: BigInt(String(subjectPayload.horizonSec ?? '3600')),
        nonce: BigInt(String(subjectPayload.nonce ?? '0')),
        submittedAt: BigInt(String(subjectPayload.submittedAt ?? '0'))
      };

      const canonical = buildCanonicalAllocationClaimRecord({ claim });
      if (canonical.claimHash.toLowerCase() !== subjectHash.toLowerCase()) {
        return {
          ...base,
          verdict: 'FAIL',
          reason: 'claim hash mismatch against canonical allocation claim',
          reasonCode: 'HASH_MISMATCH',
          confidence: 0.95,
          assumptions: ['canonical hash uses SDK AllocationClaimV1 rules']
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ...base,
        verdict: 'FAIL',
        reason: `claim normalization failed: ${message}`,
        reasonCode: 'REPRODUCTION_FAILED',
        confidence: 0.9,
        assumptions: []
      };
    }
  }

  if (subjectType === 'INTENT' && !('snapshotHash' in subjectPayload)) {
    return {
      ...base,
      verdict: 'NEED_MORE_EVIDENCE',
      reason: 'intent payload missing snapshotHash',
      reasonCode: 'MISSING_FIELDS',
      confidence: 0,
      assumptions: []
    };
  }

  return {
    ...base,
    verdict: 'PASS',
    reason: 'subject payload passes deterministic scope/hash checks',
    reasonCode: 'OK',
    confidence: 0.95,
    assumptions: ['participant validation is schema/hash based in allocation-claim mode']
  };
}

export async function submitAllocation(
  input: SubmitAllocationInput
): Promise<SubmitAllocationOutput> {
  try {
    const claim = fromSerializedClaim(input.observation.canonicalClaim);
    const canonical = buildCanonicalAllocationClaimRecord({ claim });

    const safety = participantSubmitSafety(
      input.submit ?? false,
      input.disableAutoSubmit ?? false
    );
    if (safety.submitRequested && !safety.autoSubmitEnabled) {
      return {
        status: 'ERROR',
        fundId: input.fundId,
        epochId: input.epochId,
        claimHash: canonical.claimHash,
        reasonCode: 'SAFETY_BLOCKED',
        error:
          'submit was requested but PARTICIPANT_AUTO_SUBMIT is disabled. Set PARTICIPANT_AUTO_SUBMIT=true to allow external submission.',
        safety
      };
    }

    if (!safety.shouldSubmit) {
      return {
        status: 'OK',
        fundId: input.fundId,
        epochId: input.epochId,
        decision: 'READY',
        claimHash: canonical.claimHash,
        reasonCode: 'OK',
        safety
      };
    }

    const relayerUrl = process.env.RELAYER_URL ?? '';
    if (!relayerUrl) {
      return {
        status: 'ERROR',
        fundId: input.fundId,
        epochId: input.epochId,
        reasonCode: 'NETWORK_ERROR',
        error: 'RELAYER_URL is required',
        safety
      };
    }

    try {
      validateParticipantRelayerUrl(relayerUrl, safety.trustedRelayerHosts);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        status: 'ERROR',
        fundId: input.fundId,
        epochId: input.epochId,
        claimHash: canonical.claimHash,
        reasonCode: 'SAFETY_BLOCKED',
        error: message,
        safety
      };
    }

    const client = createRelayerClient(input.clientOptions ?? {});
    const response = await client.submitClaim(input.fundId, canonical.claim);

    return {
      status: 'OK',
      fundId: input.fundId,
      epochId: input.epochId,
      decision: 'SUBMITTED',
      claimHash: response.claimHash,
      response,
      reasonCode: 'OK',
      safety
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: 'ERROR',
      fundId: input.fundId,
      epochId: input.epochId,
      reasonCode: 'NETWORK_ERROR',
      error: message
    };
  }
}
