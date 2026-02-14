import { randomBytes } from 'node:crypto';
import {
  buildCanonicalClaimRecord,
  type Address,
  type ClaimPayload
} from '@claw/protocol-sdk';
import {
  createRelayerClient,
  type RelayerClientOptions
} from '../../lib/relayer-client.js';
import { createBotSigner, type BotSignerOptions } from '../../lib/signer.js';
import { isAddress, keccak256, toHex } from 'viem';

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
    allowHosts?: string[];
  };
  tokenContext: {
    symbol: string;
    address: string;
  };
  crawlerAddress?: Address;
  maxResponseBytes?: number;
}

export interface SerializedClaimPayload
  extends Omit<ClaimPayload, 'timestamp'> {
  timestamp: string;
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
  canonicalPayload: SerializedClaimPayload;
}

export interface MineClaimOutput {
  status: 'OK' | 'ERROR';
  taskType: 'mine_claim';
  fundId: string;
  epochId: number;
  observation?: MineClaimObservation;
  confidence: number;
  assumptions: string[];
  reasonCode?: string;
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
  reasonCode:
    | 'OK'
    | 'MISSING_FIELDS'
    | 'INVALID_SCOPE'
    | 'STALE_DATA'
    | 'REPRODUCTION_FAILED'
    | 'HASH_MISMATCH';
  attestationDraft?: {
    validator: string;
    expiresAt: number;
    nonce: string;
  };
  confidence: number;
  assumptions: string[];
  error?: string;
}

export interface SubmitMinedClaimInput {
  fundId: string;
  epochId: number;
  observation: MineClaimObservation;
  clientOptions?: RelayerClientOptions;
  submit?: boolean;
}

export interface SubmitMinedClaimOutput {
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

export interface AttestClaimInput {
  fundId: string;
  claimHash: `0x${string}`;
  epochId: number;
  expiresInSeconds?: number;
  nonce?: bigint | number | string;
  clientOptions?: RelayerClientOptions;
  signerOptions?: BotSignerOptions;
  submit?: boolean;
}

export interface AttestClaimOutput {
  status: 'OK' | 'ERROR';
  fundId: string;
  claimHash: `0x${string}`;
  decision?: 'READY' | 'SUBMITTED';
  response?: Record<string, unknown>;
  reasonCode?:
    | 'OK'
    | 'SAFETY_BLOCKED'
    | 'ATTESTATION_DOMAIN_MISMATCH'
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
const DEFAULT_MAX_RESPONSE_BYTES = 512 * 1024;
const DEFAULT_REQUIRE_EXPLICIT_SUBMIT = true;
const DEFAULT_AUTO_SUBMIT = false;
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

const serializeClaimPayload = (
  payload: ClaimPayload
): SerializedClaimPayload => {
  return {
    ...payload,
    timestamp: payload.timestamp.toString()
  };
};

const deserializeClaimPayload = (
  payload: SerializedClaimPayload
): ClaimPayload => {
  return {
    ...payload,
    timestamp: BigInt(payload.timestamp)
  };
};

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

const normalizedHostAllowlist = (hosts: string[] | undefined): Set<string> => {
  const envHosts = parseEnvCsv(process.env.PARTICIPANT_ALLOWED_SOURCE_HOSTS);
  const allHosts = [...envHosts, ...(hosts ?? [])]
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return new Set(allHosts);
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
  submitRequested: boolean
): {
  submitRequested: boolean;
  autoSubmitEnabled: boolean;
  requireExplicitSubmit: boolean;
  trustedRelayerHosts: string[];
  shouldSubmit: boolean;
} => {
  const requireExplicitSubmit = envBool(
    'PARTICIPANT_REQUIRE_EXPLICIT_SUBMIT',
    DEFAULT_REQUIRE_EXPLICIT_SUBMIT
  );
  const autoSubmitEnabled = envBool('PARTICIPANT_AUTO_SUBMIT', DEFAULT_AUTO_SUBMIT);
  const hosts = trustedRelayerHosts();
  const shouldSubmit = submitRequested || (!requireExplicitSubmit && autoSubmitEnabled);
  return {
    submitRequested,
    autoSubmitEnabled,
    requireExplicitSubmit,
    trustedRelayerHosts: hosts,
    shouldSubmit
  };
};

const maxResponseBytesFromEnv = (override?: number): number => {
  if (override !== undefined && Number.isFinite(override) && override > 0) {
    return Math.trunc(override);
  }
  const raw = process.env.PARTICIPANT_MAX_RESPONSE_BYTES;
  if (!raw) return DEFAULT_MAX_RESPONSE_BYTES;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MAX_RESPONSE_BYTES;
  }
  return Math.trunc(parsed);
};

const crawlerAddress = (value?: string): Address => {
  const raw = (value ?? process.env.CRAWLER_ADDRESS ?? '').trim();
  if (!raw) return ZERO_ADDRESS;
  if (!isAddress(raw)) {
    throw new Error(`invalid crawler address: ${raw}`);
  }
  return raw as Address;
};

const validateSourceRef = (
  sourceRef: string,
  allowHosts?: string[]
): URL => {
  let url: URL;
  try {
    url = new URL(sourceRef);
  } catch {
    throw new Error(`invalid sourceRef URL: ${sourceRef}`);
  }

  if (url.protocol !== 'https:' && process.env.PARTICIPANT_ALLOW_HTTP_SOURCE !== 'true') {
    throw new Error('only https sourceRef is allowed (set PARTICIPANT_ALLOW_HTTP_SOURCE=true for local dev)');
  }

  const allowlist = normalizedHostAllowlist(allowHosts);
  const host = url.hostname.trim().toLowerCase();
  if (allowlist.size > 0) {
    if (!allowlist.has(host)) {
      throw new Error(`sourceRef host is not allowlisted: ${host}`);
    }
    return url;
  }

  if (isPrivateHostname(host)) {
    throw new Error(`private/internal host is not allowed: ${host}`);
  }
  return url;
};

const readResponseTextWithLimit = async (
  response: Response,
  maxBytes: number
): Promise<string> => {
  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const announced = Number(contentLength);
    if (Number.isFinite(announced) && announced > maxBytes) {
      throw new Error(`response exceeds max size (${announced} > ${maxBytes})`);
    }
  }

  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new Error(`response exceeds max size (${maxBytes} bytes)`);
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';

  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > maxBytes) {
      throw new Error(`response exceeds max size (${maxBytes} bytes)`);
    }
    text += decoder.decode(next.value, { stream: true });
  }
  text += decoder.decode();
  return text;
};

const fetchSourceBody = async (
  sourceRef: string,
  freshnessSeconds: number,
  allowHosts?: string[],
  maxBytes?: number
): Promise<string> => {
  const timeoutMs = Math.max(1, freshnessSeconds) * 1000;
  const validated = validateSourceRef(sourceRef, allowHosts);
  const response = await fetch(validated.toString(), {
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      Accept: 'application/json,text/plain,*/*'
    }
  });
  if (!response.ok) {
    throw new Error(`source responded with HTTP ${response.status}`);
  }
  return readResponseTextWithLimit(response, maxResponseBytesFromEnv(maxBytes));
};

const claimPayloadFromMine = (input: {
  sourceSpecId: string;
  sourceRef: string;
  tokenAddress: string;
  extracted: string;
  responseHash: string;
  timestamp: number;
  crawler: Address;
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
    crawler: input.crawler,
    notes: `sourceSpecId=${input.sourceSpecId}`
  };
};

const defaultNonce = (): bigint => {
  const ms = BigInt(Date.now());
  const rand = BigInt(`0x${randomBytes(8).toString('hex')}`);
  return (ms << 64n) | rand;
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
      reasonCode: 'MISSING_FIELDS',
      error: 'sourceSpec.sourceRef and sourceSpecId are required'
    };
  }
  if (!isAddress(tokenContext.address)) {
    return {
      status: 'ERROR',
      taskType: 'mine_claim',
      fundId,
      epochId,
      confidence: 0,
      assumptions: [],
      reasonCode: 'INVALID_SCOPE',
      error: `invalid token address: ${tokenContext.address}`
    };
  }

  try {
    const body = await fetchSourceBody(
      sourceSpec.sourceRef,
      sourceSpec.freshnessSeconds,
      sourceSpec.allowHosts,
      input.maxResponseBytes
    );
    const responseHash = keccak256(toHex(body));
    const timestamp = nowSeconds();
    const extracted = body.slice(0, 256);
    const payload = claimPayloadFromMine({
      sourceSpecId: sourceSpec.sourceSpecId,
      sourceRef: sourceSpec.sourceRef,
      tokenAddress: tokenContext.address,
      extracted,
      responseHash,
      timestamp,
      crawler: crawlerAddress(input.crawlerAddress)
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
        crawler: payload.crawler,
        canonicalPayload: serializeClaimPayload(payload)
      },
      confidence: 0.75,
      assumptions: [
        'extractor logic uses deterministic raw-body slice (first 256 chars)',
        'claimHash is computed via SDK canonical claim encoding'
      ],
      reasonCode: 'OK'
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
      reasonCode: 'REPRODUCTION_FAILED',
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
    subjectHash
  };

  if (subjectType === 'CLAIM') {
    const missing = REQUIRED_CLAIM_FIELDS.filter((field) => !(field in subjectPayload));
    if (missing.length > 0) {
      return {
        ...base,
        verdict: 'NEED_MORE_EVIDENCE',
        reason: `missing fields: ${missing.join(', ')}`,
        reasonCode: 'MISSING_FIELDS',
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
      reasonCode: 'MISSING_FIELDS',
      confidence: 0,
      assumptions: []
    };
  }

  const payloadTimestamp = Number(subjectPayload.timestamp ?? 0);
  if (payloadTimestamp > 0 && validationPolicy.maxDataAgeSeconds > 0) {
    const age = nowSeconds() - payloadTimestamp;
    if (age > validationPolicy.maxDataAgeSeconds) {
      return {
        ...base,
        verdict: 'FAIL',
        reason: `data age ${age}s exceeds max ${validationPolicy.maxDataAgeSeconds}s`,
        reasonCode: 'STALE_DATA',
        confidence: 0.65,
        assumptions: ['freshness evaluated against current wall-clock time']
      };
    }
  }

  if (subjectType === 'CLAIM' && validationPolicy.reproducible) {
    const sourceRef = String(subjectPayload.sourceRef ?? '');
    const expectedResponseHash = String(subjectPayload.responseHash ?? '').toLowerCase();
    if (!sourceRef || !expectedResponseHash) {
      return {
        ...base,
        verdict: 'NEED_MORE_EVIDENCE',
        reason: 'reproducible check requires sourceRef and responseHash',
        reasonCode: 'MISSING_FIELDS',
        confidence: 0,
        assumptions: []
      };
    }
    try {
      const body = await fetchSourceBody(sourceRef, Math.max(5, validationPolicy.maxDataAgeSeconds));
      const recrawledHash = keccak256(toHex(body)).toLowerCase();
      if (recrawledHash !== expectedResponseHash) {
        return {
          ...base,
          verdict: 'FAIL',
          reason: 'responseHash mismatch after re-fetch',
          reasonCode: 'HASH_MISMATCH',
          confidence: 0.9,
          assumptions: ['re-fetched source payload was hashed using keccak256(utf8 body)']
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ...base,
        verdict: 'FAIL',
        reason: `reproducibility check failed: ${message}`,
        reasonCode: 'REPRODUCTION_FAILED',
        confidence: 0.8,
        assumptions: []
      };
    }
  }

  return {
    ...base,
    verdict: 'PASS',
    reason: 'required fields are present and validation policy checks passed',
    reasonCode: 'OK',
    attestationDraft: {
      validator:
        process.env.BOT_ADDRESS ??
        process.env.VERIFIER_ADDRESS ??
        '0x0000000000000000000000000000000000000000',
      expiresAt: nowSeconds() + 900,
      nonce: defaultNonce().toString()
    },
    confidence: 0.9,
    assumptions: ['verification is deterministic under the same source response and policy']
  };
}

export async function submitMinedClaim(
  input: SubmitMinedClaimInput
): Promise<SubmitMinedClaimOutput> {
  try {
    const canonicalPayload = input.observation.canonicalPayload
      ? deserializeClaimPayload(input.observation.canonicalPayload)
      : claimPayloadFromMine({
          sourceSpecId: input.observation.sourceSpecId,
          sourceRef: input.observation.evidenceURI,
          tokenAddress: input.observation.token,
          extracted: input.observation.extracted,
          responseHash: input.observation.responseHash,
          timestamp: input.observation.timestamp,
          crawler: crawlerAddress(input.observation.crawler)
        });

    const record = buildCanonicalClaimRecord({
      payload: canonicalPayload,
      epochId: BigInt(input.epochId)
    });
    if (record.claimHash.toLowerCase() !== input.observation.claimHash.toLowerCase()) {
      return {
        status: 'ERROR',
        fundId: input.fundId,
        epochId: input.epochId,
        reasonCode: 'CLAIM_HASH_MISMATCH',
        error: `observation claimHash mismatch (expected ${record.claimHash}, received ${input.observation.claimHash})`
      };
    }

    const safety = participantSubmitSafety(input.submit ?? false);
    if (safety.submitRequested && !safety.autoSubmitEnabled) {
      return {
        status: 'ERROR',
        fundId: input.fundId,
        epochId: input.epochId,
        claimHash: record.claimHash,
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
        claimHash: record.claimHash,
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
        claimHash: record.claimHash,
        reasonCode: 'SAFETY_BLOCKED',
        error: message,
        safety
      };
    }

    const client = createRelayerClient(input.clientOptions ?? {});

    const response = await client.submitClaim(
      input.fundId,
      canonicalPayload,
      BigInt(input.epochId)
    );
    if (response.claimHash.toLowerCase() !== record.claimHash.toLowerCase()) {
      return {
        status: 'ERROR',
        fundId: input.fundId,
        epochId: input.epochId,
        reasonCode: 'CLAIM_HASH_MISMATCH',
        error: `relayer claimHash mismatch (expected ${record.claimHash}, received ${response.claimHash})`
      };
    }

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

export async function attestClaim(input: AttestClaimInput): Promise<AttestClaimOutput> {
  try {
    const safety = participantSubmitSafety(input.submit ?? false);

    if (safety.submitRequested && !safety.autoSubmitEnabled) {
      return {
        status: 'ERROR',
        fundId: input.fundId,
        claimHash: input.claimHash,
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
        claimHash: input.claimHash,
        decision: 'READY',
        reasonCode: 'OK',
        safety
      };
    }

    const relayerUrl = process.env.RELAYER_URL ?? '';
    if (!relayerUrl) {
      return {
        status: 'ERROR',
        fundId: input.fundId,
        claimHash: input.claimHash,
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
        claimHash: input.claimHash,
        reasonCode: 'SAFETY_BLOCKED',
        error: message,
        safety
      };
    }

    const signer = createBotSigner(input.signerOptions ?? {});
    const client = createRelayerClient(input.clientOptions ?? {});
    const expiresAt = BigInt(
      nowSeconds() + (input.expiresInSeconds === undefined ? 900 : input.expiresInSeconds)
    );
    const nonce = input.nonce === undefined ? defaultNonce() : BigInt(input.nonce);

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
      decision: 'SUBMITTED',
      response,
      reasonCode: 'OK',
      safety
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const reasonCode = message.includes('CLAIM_ATTESTATION_VERIFIER_ADDRESS')
      ? 'ATTESTATION_DOMAIN_MISMATCH'
      : 'NETWORK_ERROR';
    return {
      status: 'ERROR',
      fundId: input.fundId,
      claimHash: input.claimHash,
      reasonCode,
      error: message
    };
  }
}
