export interface MineClaimInput {
  taskType: "mine_claim";
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
  sourceSpecId: string;
  token: string;
  timestamp: number;
  extracted: string;
  responseHash: string;
  evidenceURI: string;
  crawler: string;
}

export interface MineClaimOutput {
  status: "OK" | "ERROR";
  taskType: "mine_claim";
  fundId: string;
  epochId: number;
  observation?: MineClaimObservation;
  confidence: number;
  assumptions: string[];
  error?: string;
}

export interface VerifyClaimInput {
  taskType: "verify_claim_or_intent_validity";
  fundId: string;
  roomId: string;
  epochId: number;
  subjectType: "CLAIM" | "INTENT";
  subjectHash: string;
  subjectPayload: Record<string, unknown>;
  validationPolicy: {
    reproducible: boolean;
    maxDataAgeSeconds: number;
  };
}

export interface VerifyClaimOutput {
  status: "OK" | "ERROR";
  taskType: "verify_claim_or_intent_validity";
  fundId: string;
  roomId: string;
  epochId: number;
  subjectType: "CLAIM" | "INTENT";
  subjectHash: string;
  verdict: "PASS" | "FAIL" | "NEED_MORE_EVIDENCE";
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

function simpleHexHash(data: string): string {
  const hex = Buffer.from(data, "utf-8").toString("hex");
  return "0x" + hex.slice(0, 64).padEnd(64, "0");
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export async function mineClaim(input: MineClaimInput): Promise<MineClaimOutput> {
  const { sourceSpec, tokenContext, fundId, epochId } = input;

  if (!sourceSpec.sourceRef || !sourceSpec.sourceSpecId) {
    return {
      status: "ERROR",
      taskType: "mine_claim",
      fundId,
      epochId,
      confidence: 0,
      assumptions: [],
      error: "sourceSpec.sourceRef and sourceSpecId are required",
    };
  }

  try {
    const res = await fetch(sourceSpec.sourceRef, {
      signal: AbortSignal.timeout(sourceSpec.freshnessSeconds * 1000),
    });

    if (!res.ok) {
      return {
        status: "ERROR",
        taskType: "mine_claim",
        fundId,
        epochId,
        confidence: 0,
        assumptions: [],
        error: `source responded with HTTP ${res.status}`,
      };
    }

    const body = await res.text();
    const responseHash = simpleHexHash(body);
    const timestamp = nowSeconds();

    const extracted = body.slice(0, 256);

    return {
      status: "OK",
      taskType: "mine_claim",
      fundId,
      epochId,
      observation: {
        sourceSpecId: sourceSpec.sourceSpecId,
        token: tokenContext.address,
        timestamp,
        extracted,
        responseHash,
        evidenceURI: sourceSpec.sourceRef,
        crawler: "0x0000000000000000000000000000000000000000",
      },
      confidence: 0.7,
      assumptions: ["extractor logic is placeholder; raw body slice used"],
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: "ERROR",
      taskType: "mine_claim",
      fundId,
      epochId,
      confidence: 0,
      assumptions: [],
      error: `fetch failed: ${message}`,
    };
  }
}

const REQUIRED_CLAIM_FIELDS = ["sourceRef", "extracted", "responseHash", "evidenceURI"] as const;

export async function verifyClaim(input: VerifyClaimInput): Promise<VerifyClaimOutput> {
  const { fundId, roomId, epochId, subjectType, subjectHash, subjectPayload, validationPolicy } =
    input;

  const base = {
    status: "OK" as const,
    taskType: "verify_claim_or_intent_validity" as const,
    fundId,
    roomId,
    epochId,
    subjectType,
    subjectHash,
  };

  if (subjectType === "CLAIM") {
    const missing = REQUIRED_CLAIM_FIELDS.filter((f) => !(f in subjectPayload));
    if (missing.length > 0) {
      return {
        ...base,
        verdict: "NEED_MORE_EVIDENCE",
        reason: `missing fields: ${missing.join(", ")}`,
        confidence: 0,
        assumptions: [],
      };
    }
  }

  if (subjectType === "INTENT" && !("snapshotHash" in subjectPayload)) {
    return {
      ...base,
      verdict: "NEED_MORE_EVIDENCE",
      reason: "intent payload missing snapshotHash",
      confidence: 0,
      assumptions: [],
    };
  }

  const payloadTimestamp = Number(subjectPayload["timestamp"] ?? 0);
  if (payloadTimestamp > 0 && validationPolicy.maxDataAgeSeconds > 0) {
    const age = nowSeconds() - payloadTimestamp;
    if (age > validationPolicy.maxDataAgeSeconds) {
      return {
        ...base,
        verdict: "FAIL",
        reason: `data age ${age}s exceeds max ${validationPolicy.maxDataAgeSeconds}s`,
        confidence: 0.6,
        assumptions: ["freshness evaluated against current wall-clock time"],
      };
    }
  }

  return {
    ...base,
    verdict: "PASS",
    reason: "all required fields present, freshness within bounds",
    attestationDraft: {
      validator: "0x0000000000000000000000000000000000000000",
      expiresAt: nowSeconds() + 900,
      nonce: Date.now(),
    },
    confidence: 0.85,
    assumptions: [
      "reproduction check is placeholder — production should re-fetch and compare",
    ],
  };
}
