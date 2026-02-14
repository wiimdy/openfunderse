import {
  buildCanonicalClaimRecord,
  type Address,
  type ClaimPayload
} from '@claw/protocol-sdk';
import { createRelayerClient } from '../../lib/relayer-client.js';
import { createBotSigner } from '../../lib/signer.js';
import { keccak256, toHex } from 'viem';

export interface MineClaimInput {
  taskType: 'mine_claim';
  fundId: string;
  roomId: string;
  epochId: number;
  sourceSpec: {
    sourceSpecId: string;
    sourceRef: string;
    extractor: Record<string, unknown>;
    freshnessSeconds: number;
  };
  tokenContext: {
    symbol: string;
    address: string;
  };
}

export interface MineClaimObservation {
  claimHash: string;
  sourceSpecId: string;
  token: string;
  timestamp: number;
  extracted: string;
  responseHash: string;
  evidenceURI: string;
  crawler: string;
}

export interface MineClaimOutput {
  status: 'OK' | 'ERROR';
  taskType: 'mine_claim';
  fundId: string;
  epochId: number;
  observation?: MineClaimObservation;
  confidence: number;
  assumptions: string[];
  error?: string;
}

export interface VerifyClaimInput {
  taskType: 'verify_claim_or_intent_validity';
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

export interface VerifyClaimOutput {
  status: 'OK' | 'ERROR';
  taskType: 'verify_claim_or_intent_validity';
  fundId: string;
  roomId: string;
  epochId: number;
  subjectType: 'CLAIM' | 'INTENT';
  subjectHash: string;
  verdict: 'PASS' | 'FAIL' | 'NEED_MORE_EVIDENCE';
  reason: string;
  attestationDraft?: {
    validator: string;
    expiresAt: number;
    nonce: number;
  };
  confidence: number;
  assumptions: string[];
  error?: string;
}

export interface SubmitMinedClaimInput {
  fundId: string;
  epochId: number;
  observation: MineClaimObservation;
  templateType?: string;
}

export interface SubmitMinedClaimOutput {
  status: 'OK' | 'ERROR';
  fundId: string;
  epochId: number;
  claimHash?: string;
  response?: Record<string, unknown>;
  error?: string;
}

export interface AttestClaimInput {
  fundId: string;
  claimHash: `0x${string}`;
  epochId: number;
  expiresInSeconds?: number;
  nonce?: bigint | number | string;
}

export interface AttestClaimOutput {
  status: 'OK' | 'ERROR';
  fundId: string;
  claimHash: `0x${string}`;
  response?: Record<string, unknown>;
  error?: string;
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

const crawlerAddress = (): Address => {
  const raw = process.env.CRAWLER_ADDRESS?.trim();
  if (!raw) return ZERO_ADDRESS;
  return raw as Address;
};

const claimPayloadFromMine = (input: {
  sourceSpecId: string;
  sourceRef: string;
  tokenAddress: string;
  extracted: string;
  responseHash: string;
  timestamp: number;
}): ClaimPayload => {
  return {
    schemaId: 'claim_template_v0',
    sourceType: 'WEB',
    sourceRef: input.sourceRef,
    selector: '$.raw',
    extracted: JSON.stringify({
      token: input.tokenAddress,
      sample: input.extracted
    }),
    extractedType: 'json',
    timestamp: BigInt(input.timestamp),
    responseHash: input.responseHash as `0x${string}`,
    evidenceType: 'url',
    evidenceURI: input.sourceRef,
    crawler: crawlerAddress(),
    notes: `sourceSpecId=${input.sourceSpecId}`
  };
};

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export async function mineClaim(input: MineClaimInput): Promise<MineClaimOutput> {
  const { sourceSpec, tokenContext, fundId, epochId } = input;

  if (!sourceSpec.sourceRef || !sourceSpec.sourceSpecId) {
    return {
      status: 'ERROR',
      taskType: 'mine_claim',
      fundId,
      epochId,
      confidence: 0,
      assumptions: [],
      error: 'sourceSpec.sourceRef and sourceSpecId are required'
    };
  }

  try {
    const res = await fetch(sourceSpec.sourceRef, {
      signal: AbortSignal.timeout(sourceSpec.freshnessSeconds * 1000)
    });

    if (!res.ok) {
      return {
        status: 'ERROR',
        taskType: 'mine_claim',
        fundId,
        epochId,
        confidence: 0,
        assumptions: [],
        error: `source responded with HTTP ${res.status}`
      };
    }

    const body = await res.text();
    const responseHash = keccak256(toHex(body));
    const timestamp = nowSeconds();
    const extracted = body.slice(0, 256);
    const payload = claimPayloadFromMine({
      sourceSpecId: sourceSpec.sourceSpecId,
      sourceRef: sourceSpec.sourceRef,
      tokenAddress: tokenContext.address,
      extracted,
      responseHash,
      timestamp
    });
    const canonicalRecord = buildCanonicalClaimRecord({
      payload,
      epochId: BigInt(epochId)
    });

    return {
      status: 'OK',
      taskType: 'mine_claim',
      fundId,
      epochId,
      observation: {
        claimHash: canonicalRecord.claimHash,
        sourceSpecId: sourceSpec.sourceSpecId,
        token: tokenContext.address,
        timestamp,
        extracted,
        responseHash,
        evidenceURI: sourceSpec.sourceRef,
        crawler: payload.crawler
      },
      confidence: 0.7,
      assumptions: [
        'extractor logic is placeholder; raw body slice used',
        'claimHash is computed via SDK canonical claim encoding'
      ]
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: 'ERROR',
      taskType: 'mine_claim',
      fundId,
      epochId,
      confidence: 0,
      assumptions: [],
      error: `fetch failed: ${message}`
    };
  }
}

const REQUIRED_CLAIM_FIELDS = [
  'sourceRef',
  'extracted',
  'responseHash',
  'evidenceURI'
] as const;

export async function verifyClaim(input: VerifyClaimInput): Promise<VerifyClaimOutput> {
  const { fundId, roomId, epochId, subjectType, subjectHash, subjectPayload, validationPolicy } =
    input;

  const base = {
    status: 'OK' as const,
    taskType: 'verify_claim_or_intent_validity' as const,
    fundId,
    roomId,
    epochId,
    subjectType,
    subjectHash,
  };

  if (subjectType === 'CLAIM') {
    const missing = REQUIRED_CLAIM_FIELDS.filter((f) => !(f in subjectPayload));
    if (missing.length > 0) {
      return {
        ...base,
        verdict: 'NEED_MORE_EVIDENCE',
        reason: `missing fields: ${missing.join(", ")}`,
        confidence: 0,
        assumptions: []
      };
    }
  }

  if (subjectType === 'INTENT' && !('snapshotHash' in subjectPayload)) {
    return {
      ...base,
      verdict: 'NEED_MORE_EVIDENCE',
      reason: 'intent payload missing snapshotHash',
      confidence: 0,
      assumptions: []
    };
  }

  const payloadTimestamp = Number(subjectPayload['timestamp'] ?? 0);
  if (payloadTimestamp > 0 && validationPolicy.maxDataAgeSeconds > 0) {
    const age = nowSeconds() - payloadTimestamp;
    if (age > validationPolicy.maxDataAgeSeconds) {
      return {
        ...base,
        verdict: 'FAIL',
        reason: `data age ${age}s exceeds max ${validationPolicy.maxDataAgeSeconds}s`,
        confidence: 0.6,
        assumptions: ['freshness evaluated against current wall-clock time']
      };
    }
  }

  return {
    ...base,
    verdict: 'PASS',
    reason: 'all required fields present, freshness within bounds',
    attestationDraft: {
      validator: '0x0000000000000000000000000000000000000000',
      expiresAt: nowSeconds() + 900,
      nonce: Date.now()
    },
    confidence: 0.85,
    assumptions: ['reproduction check is placeholder; production should re-fetch and compare']
  };
}

export async function submitMinedClaim(
  input: SubmitMinedClaimInput
): Promise<SubmitMinedClaimOutput> {
  const client = createRelayerClient();
  try {
    const response = await client.submitClaimTemplate(
      input.fundId,
      {
        templateType: input.templateType ?? 'participant_mine_claim_v1',
        sourceRef: input.observation.evidenceURI,
        observedAt: BigInt(input.observation.timestamp),
        raw: {
          sourceSpecId: input.observation.sourceSpecId,
          token: input.observation.token,
          extracted: input.observation.extracted,
          responseHash: input.observation.responseHash
        },
        notes: `sourceSpecId=${input.observation.sourceSpecId}`
      },
      BigInt(input.epochId)
    );
    return {
      status: 'OK',
      fundId: input.fundId,
      epochId: input.epochId,
      claimHash: response.claimHash,
      response
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: 'ERROR',
      fundId: input.fundId,
      epochId: input.epochId,
      error: message
    };
  }
}

export async function attestClaim(input: AttestClaimInput): Promise<AttestClaimOutput> {
  const signer = createBotSigner();
  const client = createRelayerClient();
  const expiresAt = BigInt(
    nowSeconds() + (input.expiresInSeconds === undefined ? 900 : input.expiresInSeconds)
  );
  const nonce = input.nonce === undefined ? BigInt(Date.now()) : BigInt(input.nonce);

  try {
    const signed = await signer.signClaimAttestation({
      claimHash: input.claimHash,
      epochId: BigInt(input.epochId),
      expiresAt,
      nonce
    });
    const response = await client.submitClaimAttestation(input.fundId, {
      claimHash: signed.message.claimHash,
      epochId: signed.message.epochId,
      verifier: signed.verifier,
      expiresAt: signed.message.expiresAt,
      nonce: signed.message.nonce,
      signature: signed.signature
    });
    return {
      status: 'OK',
      fundId: input.fundId,
      claimHash: input.claimHash,
      response
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: 'ERROR',
      fundId: input.fundId,
      claimHash: input.claimHash,
      error: message
    };
  }
}
