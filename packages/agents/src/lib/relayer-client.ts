import { randomUUID } from 'node:crypto';
import {
  buildCanonicalAllocationClaimRecord,
  type AllocationClaimV1,
  type Address,
  type Hex,
  type IntentExecutionRouteInput,
  type TradeIntent
} from '@claw/protocol-sdk';
import { EventSource } from 'eventsource';
import { keccak256, toHex } from 'viem';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

export interface ClaimTemplateInput {
  templateType: string;
  sourceRef: string;
  raw: unknown;
  observedAt?: bigint | number | string;
  meta?: Record<string, unknown>;
  sourceType?: string;
  selector?: string;
  extractedType?: string;
  evidenceType?: string;
  evidenceURI?: string;
  notes?: string;
  crawler?: Address;
}

// Legacy local shape kept only for source-fetch template handling in agents.
export interface ClaimPayload {
  schemaId: string;
  sourceType: string;
  sourceRef: string;
  selector: string;
  extracted: string;
  extractedType: string;
  timestamp: bigint;
  responseHash: Hex;
  evidenceType: string;
  evidenceURI: string;
  crawler: Address;
  notes?: string;
}

export interface ClaimQuery {
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';
  epochId?: bigint | number | string;
  limit?: number;
  offset?: number;
}

export interface IntentAttestationInput {
  intentHash: Hex;
  verifier: Address;
  expiresAt: bigint | number | string;
  nonce: bigint | number | string;
  signature: Hex;
}

export interface RelayerProposeIntentInput {
  intent: TradeIntent;
  executionRoute: IntentExecutionRouteInput;
  maxNotional?: bigint | number | string;
  intentURI?: string;
}

export interface RelayerClientOptions {
  baseUrl?: string;
  botId?: string;
  botApiKey?: string;
  botAddress?: Address;
  requestTimeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  authOnRead?: boolean;
  defaultHeaders?: Record<string, string>;
}

export interface RelayerHttpErrorShape {
  endpoint: string;
  status: number | null;
  code: string;
  message: string;
  retryable: boolean;
  requestId: string;
  details?: unknown;
}

export class RelayerHttpError extends Error implements RelayerHttpErrorShape {
  endpoint: string;
  status: number | null;
  code: string;
  retryable: boolean;
  requestId: string;
  details?: unknown;

  constructor(shape: RelayerHttpErrorShape) {
    super(shape.message);
    this.name = 'RelayerHttpError';
    this.endpoint = shape.endpoint;
    this.status = shape.status;
    this.code = shape.code;
    this.retryable = shape.retryable;
    this.requestId = shape.requestId;
    this.details = shape.details;
  }
}

export interface SseEvent<TType extends string = string, TData = unknown> {
  type: TType;
  id: string;
  data: TData;
}

export interface SseHandlers<TType extends string> {
  onOpen?: () => void;
  onEvent?: (event: SseEvent<TType>) => void;
  onError?: (error: unknown) => void;
}

export interface SseSubscription {
  close: () => void;
}

type IntentEventType = 'intent:attested';

interface RequestConfig {
  method: 'GET' | 'POST';
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  withAuth?: boolean;
}

interface SubmitClaimResponse {
  claimHash: Hex;
}

function toAllocationClaim(input: {
  fundId: string;
  epochId: bigint;
  participant: Address;
  sourcePayload: ClaimPayload;
}): AllocationClaimV1 {
  return {
    claimVersion: 'v1',
    fundId: input.fundId,
    epochId: input.epochId,
    participant: input.participant,
    // v0 bridge: legacy payload is mapped into 1-asset target claim.
    targetWeights: [10_000n],
    horizonSec: 3600n,
    nonce: input.sourcePayload.timestamp,
    submittedAt: input.sourcePayload.timestamp
  };
}

export interface IntentOnchainBundleItem {
  verifier: Address;
  expiresAt: string;
  nonce: string;
  signature: Hex;
}

export interface IntentOnchainBundleResponse {
  intentHash: Hex;
  subjectState: 'PENDING' | 'READY_FOR_ONCHAIN' | 'APPROVED' | 'REJECTED';
  thresholdWeight: string;
  attestedWeight: string;
  thresholdReached: boolean;
  verifiers: Address[];
  signatures: Hex[];
  attestations: IntentOnchainBundleItem[];
}

export interface ReadyExecutionPayloadItem {
  jobId: number;
  intentHash: Hex;
  jobStatus: string;
  attemptCount: number;
  nextRunAt: number;
  maxNotional: string;
  deadline: string;
  intent: TradeIntent;
  executionRoute: IntentExecutionRouteInput;
}

export interface SyncFundDeploymentInput {
  fundId: string;
  fundName: string;
  strategyBotId: string;
  strategyBotAddress: Address;
  txHash: Hex;
  verifierThresholdWeight?: bigint | number | string;
  intentThresholdWeight?: bigint | number | string;
  strategyPolicyUri?: string;
  telegramRoomId?: string;
  telegramHandle?: string;
}

const wait = async (ms: number): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

const toBigIntOrThrow = (
  value: bigint | number | string | undefined,
  label: string
): bigint => {
  if (value === undefined) {
    throw new Error(`${label} is required`);
  }
  try {
    return BigInt(value);
  } catch {
    throw new Error(`${label} must be an integer-compatible value`);
  }
};

const canonicalizeJsonValue = (value: unknown): unknown => {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map((item) => canonicalizeJsonValue(item));
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, nested]) => [key, canonicalizeJsonValue(nested)]);
    return Object.fromEntries(entries);
  }
  return value;
};

const stableJsonStringify = (value: unknown): string => {
  const canonical = canonicalizeJsonValue(value);
  const serialized = JSON.stringify(canonical);
  if (serialized === undefined) {
    return 'null';
  }
  return serialized;
};

const parseJsonSafe = (text: string): unknown => {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

const isRetryableStatus = (status: number): boolean => {
  return status === 429 || status >= 500;
};

const isAbortError = (error: unknown): boolean => {
  return error instanceof Error && error.name === 'AbortError';
};

const normalizeErrorCode = (payload: unknown, status: number | null): string => {
  if (payload && typeof payload === 'object') {
    const maybeCode = (payload as { error?: unknown }).error;
    if (typeof maybeCode === 'string' && maybeCode.trim().length > 0) {
      return maybeCode.trim();
    }
  }
  if (status === null) return 'NETWORK_ERROR';
  return `HTTP_${status}`;
};

const normalizeErrorMessage = (payload: unknown, fallback: string): string => {
  if (payload && typeof payload === 'object') {
    const maybeMessage = (payload as { message?: unknown }).message;
    if (typeof maybeMessage === 'string' && maybeMessage.trim().length > 0) {
      return maybeMessage.trim();
    }
  }
  if (typeof payload === 'string' && payload.trim().length > 0) {
    return payload.trim();
  }
  return fallback;
};

export class RelayerClient {
  private readonly baseUrl: string;
  private readonly botId: string;
  private readonly botApiKey: string;
  private readonly botAddress: Address;
  private readonly requestTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly authOnRead: boolean;
  private readonly defaultHeaders: Record<string, string>;

  constructor(options: RelayerClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? process.env.RELAYER_URL ?? '';
    this.botId = options.botId ?? process.env.BOT_ID ?? '';
    this.botApiKey = options.botApiKey ?? process.env.BOT_API_KEY ?? '';
    this.botAddress =
      options.botAddress ?? (process.env.BOT_ADDRESS as Address | undefined) ?? ZERO_ADDRESS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 250;
    this.authOnRead = options.authOnRead ?? false;
    this.defaultHeaders = options.defaultHeaders ?? {};

    if (!this.baseUrl) {
      throw new Error('RELAYER_URL is required');
    }
    if (!this.botId) {
      throw new Error('BOT_ID is required');
    }
    if (!this.botApiKey) {
      throw new Error('BOT_API_KEY is required');
    }
  }

  async submitClaim(
    fundId: string,
    claimPayload: ClaimPayload,
    epochId: bigint | number | string
  ): Promise<SubmitClaimResponse & Record<string, unknown>> {
    const normalizedEpochId = toBigIntOrThrow(epochId, 'epochId');
    const claim = toAllocationClaim({
      fundId,
      epochId: normalizedEpochId,
      participant: this.botAddress,
      sourcePayload: claimPayload
    });
    const canonical = buildCanonicalAllocationClaimRecord({ claim });
    return this.request<SubmitClaimResponse & Record<string, unknown>>({
      method: 'POST',
      path: `/api/v1/funds/${encodeURIComponent(fundId)}/claims`,
      body: {
        claim: canonical.claim
      },
      withAuth: true
    });
  }

  async submitClaimTemplate(
    fundId: string,
    template: ClaimTemplateInput,
    epochId: bigint | number | string
  ): Promise<
    SubmitClaimResponse &
      Record<string, unknown> & {
        localClaimHash: Hex;
        canonicalPayload: ClaimPayload;
      }
  > {
    const normalizedEpochId = toBigIntOrThrow(epochId, 'epochId');
    const canonicalPayload = this.buildClaimPayloadFromTemplate(template);
    const record = buildCanonicalAllocationClaimRecord({
      claim: toAllocationClaim({
        fundId,
        epochId: normalizedEpochId,
        participant: this.botAddress,
        sourcePayload: canonicalPayload
      })
    });
    const response = await this.submitClaim(fundId, canonicalPayload, normalizedEpochId);
    if (response.claimHash.toLowerCase() !== record.claimHash.toLowerCase()) {
      throw new RelayerHttpError({
        endpoint: `POST /api/v1/funds/${fundId}/claims`,
        status: 500,
        code: 'CLAIM_HASH_MISMATCH',
        message:
          'Relayer claimHash mismatch between local canonical build and server response.',
        retryable: false,
        requestId: randomUUID(),
        details: {
          localClaimHash: record.claimHash,
          remoteClaimHash: response.claimHash
        }
      });
    }
    return {
      ...response,
      localClaimHash: record.claimHash,
      canonicalPayload
    };
  }

  async getClaims(
    fundId: string,
    query: ClaimQuery = {}
  ): Promise<Record<string, unknown>> {
    const params: Record<string, string> = {};
    if (query.status) params.status = query.status;
    if (query.epochId !== undefined) params.epochId = String(query.epochId);
    if (query.limit !== undefined) params.limit = String(query.limit);
    if (query.offset !== undefined) params.offset = String(query.offset);

    return this.request<Record<string, unknown>>({
      method: 'GET',
      path: `/api/v1/funds/${encodeURIComponent(fundId)}/claims`,
      query: params,
      withAuth: this.authOnRead
    });
  }

  async getLatestEpoch(fundId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>({
      method: 'GET',
      path: `/api/v1/funds/${encodeURIComponent(fundId)}/epochs/latest`,
      withAuth: this.authOnRead
    });
  }

  async proposeIntent(
    fundId: string,
    input: RelayerProposeIntentInput
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>({
      method: 'POST',
      path: `/api/v1/funds/${encodeURIComponent(fundId)}/intents/propose`,
      body: {
        intent: input.intent,
        executionRoute: input.executionRoute,
        maxNotional:
          input.maxNotional === undefined ? undefined : String(input.maxNotional),
        intentURI: input.intentURI
      },
      withAuth: true
    });
  }

  async submitIntentAttestations(
    fundId: string,
    attestations: IntentAttestationInput[]
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>({
      method: 'POST',
      path: `/api/v1/funds/${encodeURIComponent(fundId)}/intents/attestations/batch`,
      body: {
        attestations: attestations.map((attestation) => ({
          intentHash: attestation.intentHash,
          verifier: attestation.verifier,
          expiresAt: String(attestation.expiresAt),
          nonce: String(attestation.nonce),
          signature: attestation.signature
        }))
      },
      withAuth: true
    });
  }

  async getIntentOnchainBundle(
    fundId: string,
    intentHash: Hex
  ): Promise<IntentOnchainBundleResponse & Record<string, unknown>> {
    return this.request<IntentOnchainBundleResponse & Record<string, unknown>>({
      method: 'GET',
      path: `/api/v1/funds/${encodeURIComponent(fundId)}/intents/${encodeURIComponent(
        intentHash
      )}/onchain-bundle`,
      withAuth: true
    });
  }

  async markIntentOnchainAttested(
    fundId: string,
    intentHash: Hex,
    txHash: Hex
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>({
      method: 'POST',
      path: `/api/v1/funds/${encodeURIComponent(fundId)}/intents/${encodeURIComponent(
        intentHash
      )}/onchain-attested`,
      body: {
        txHash
      },
      withAuth: true
    });
  }

  async listReadyExecutionPayloads(
    fundId: string,
    query: { limit?: number; offset?: number } = {}
  ): Promise<
    Record<string, unknown> & {
      total: number;
      items: ReadyExecutionPayloadItem[];
    }
  > {
    const params: Record<string, string> = {};
    if (query.limit !== undefined) params.limit = String(query.limit);
    if (query.offset !== undefined) params.offset = String(query.offset);

    return this.request<
      Record<string, unknown> & {
        total: number;
        items: ReadyExecutionPayloadItem[];
      }
    >({
      method: 'GET',
      path: `/api/v1/funds/${encodeURIComponent(fundId)}/intents/ready-execution`,
      query: params,
      withAuth: true
    });
  }

  async markIntentOnchainExecuted(
    fundId: string,
    intentHash: Hex,
    txHash: Hex
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>({
      method: 'POST',
      path: `/api/v1/funds/${encodeURIComponent(fundId)}/intents/${encodeURIComponent(
        intentHash
      )}/onchain-executed`,
      body: {
        txHash
      },
      withAuth: true
    });
  }

  async markIntentOnchainFailed(
    fundId: string,
    intentHash: Hex,
    error: string,
    retryDelayMs?: number
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>({
      method: 'POST',
      path: `/api/v1/funds/${encodeURIComponent(fundId)}/intents/${encodeURIComponent(
        intentHash
      )}/onchain-failed`,
      body: {
        error,
        retryDelayMs
      },
      withAuth: true
    });
  }

  async getFundStatus(fundId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>({
      method: 'GET',
      path: `/api/v1/funds/${encodeURIComponent(fundId)}/status`,
      withAuth: this.authOnRead
    });
  }

  async syncFundDeployment(
    input: SyncFundDeploymentInput
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>({
      method: 'POST',
      path: '/api/v1/funds/sync-by-strategy',
      body: {
        fundId: input.fundId,
        fundName: input.fundName,
        strategyBotId: input.strategyBotId,
        strategyBotAddress: input.strategyBotAddress,
        txHash: input.txHash,
        verifierThresholdWeight:
          input.verifierThresholdWeight === undefined
            ? undefined
            : String(input.verifierThresholdWeight),
        intentThresholdWeight:
          input.intentThresholdWeight === undefined
            ? undefined
            : String(input.intentThresholdWeight),
        strategyPolicyUri: input.strategyPolicyUri,
        telegramRoomId: input.telegramRoomId,
        telegramHandle: input.telegramHandle
      },
      withAuth: true
    });
  }

  subscribeIntentEvents(
    fundId: string,
    handlers: SseHandlers<IntentEventType>
  ): SseSubscription {
    return this.subscribeToEvents<IntentEventType>(
      `/api/v1/funds/${encodeURIComponent(fundId)}/events/intents`,
      ['intent:attested'],
      handlers
    );
  }

  buildClaimPayloadFromTemplate(template: ClaimTemplateInput): ClaimPayload {
    if (!template.templateType || !template.sourceRef) {
      throw new Error('templateType and sourceRef are required for claim template');
    }

    const rawJson = stableJsonStringify(template.raw);
    const metaJson = template.meta ? stableJsonStringify(template.meta) : '';
    const observedAt =
      template.observedAt === undefined
        ? BigInt(Math.floor(Date.now() / 1000))
        : toBigIntOrThrow(template.observedAt, 'observedAt');
    const notes = template.notes
      ? template.notes
      : metaJson
        ? `templateType=${template.templateType};meta=${metaJson}`
        : `templateType=${template.templateType}`;

    return {
      schemaId: 'claim_template_v0',
      sourceType: template.sourceType ?? 'WEB',
      sourceRef: template.sourceRef,
      selector: template.selector ?? '$.raw',
      extracted: rawJson,
      extractedType: template.extractedType ?? 'json',
      timestamp: observedAt,
      responseHash: keccak256(toHex(rawJson)),
      evidenceType: template.evidenceType ?? 'url',
      evidenceURI: template.evidenceURI ?? template.sourceRef,
      crawler: template.crawler ?? this.botAddress,
      notes
    };
  }

  private subscribeToEvents<TType extends string>(
    path: string,
    eventTypes: TType[],
    handlers: SseHandlers<TType>
  ): SseSubscription {
    const url = new URL(path, this.baseUrl).toString();
    const headers = this.buildHeaders(this.authOnRead);

    const source = new EventSource(url, {
      fetch: (input, init) => {
        const mergedHeaders = new Headers(init?.headers);
        for (const [key, value] of Object.entries(headers)) {
          mergedHeaders.set(key, value);
        }
        return fetch(input, {
          ...init,
          headers: mergedHeaders
        });
      }
    });

    source.onopen = () => {
      handlers.onOpen?.();
    };

    source.onerror = (error: unknown) => {
      handlers.onError?.(error);
    };

    for (const eventType of eventTypes) {
      source.addEventListener(eventType, (event: Event) => {
        const maybeMessage = event as unknown as {
          data?: string;
          lastEventId?: string;
        };
        handlers.onEvent?.({
          type: eventType,
          id: maybeMessage.lastEventId ?? '',
          data: parseJsonSafe(maybeMessage.data ?? '')
        });
      });
    }

    return {
      close: () => {
        source.close();
      }
    };
  }

  private async request<T>(config: RequestConfig): Promise<T> {
    const url = new URL(config.path, this.baseUrl);
    if (config.query) {
      for (const [key, value] of Object.entries(config.query)) {
        url.searchParams.set(key, value);
      }
    }

    const endpoint = `${config.method} ${config.path}`;
    const requestId = randomUUID();
    const headers = this.buildHeaders(config.withAuth ?? config.method !== 'GET');
    headers['x-request-id'] = requestId;
    if (config.body !== undefined && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const body =
      config.body === undefined
        ? undefined
        : JSON.stringify(config.body, (_key, value) =>
            typeof value === 'bigint' ? value.toString() : value
          );

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const response = await fetch(url, {
          method: config.method,
          headers,
          body,
          signal: AbortSignal.timeout(this.requestTimeoutMs)
        });
        const text = await response.text();
        const parsed = parseJsonSafe(text);

        if (response.ok) {
          return (parsed as T) ?? ({} as T);
        }

        const retryable = isRetryableStatus(response.status);
        if (retryable && attempt < this.maxRetries) {
          const backoffMs = this.retryBaseDelayMs * (attempt + 1);
          await wait(backoffMs);
          continue;
        }

        throw new RelayerHttpError({
          endpoint,
          status: response.status,
          code: normalizeErrorCode(parsed, response.status),
          message: normalizeErrorMessage(parsed, response.statusText || 'Request failed'),
          retryable,
          requestId,
          details: parsed
        });
      } catch (error) {
        if (error instanceof RelayerHttpError) {
          throw error;
        }

        const retryable = true;
        if (attempt < this.maxRetries) {
          const backoffMs = this.retryBaseDelayMs * (attempt + 1);
          await wait(backoffMs);
          continue;
        }

        const message = error instanceof Error ? error.message : String(error);
        const code = isAbortError(error) ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR';
        throw new RelayerHttpError({
          endpoint,
          status: null,
          code,
          message,
          retryable,
          requestId,
          details: error
        });
      }
    }

    throw new RelayerHttpError({
      endpoint,
      status: null,
      code: 'UNKNOWN',
      message: 'Request failed with exhausted retries.',
      retryable: false,
      requestId,
      details: null
    });
  }

  private buildHeaders(withAuth: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...this.defaultHeaders
    };

    if (withAuth) {
      headers['x-bot-id'] = this.botId;
      headers['x-bot-api-key'] = this.botApiKey;
    }

    return headers;
  }
}

export const createRelayerClient = (
  options: RelayerClientOptions = {}
): RelayerClient => {
  return new RelayerClient(options);
};
