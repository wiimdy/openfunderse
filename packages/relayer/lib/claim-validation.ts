export interface FundAllowlistSource {
  allowlist_tokens_json?: string | null;
}

export function parseFundAllowlistTokens(
  fund: Pick<FundAllowlistSource, "allowlist_tokens_json">
): string[] | null {
  const raw = fund.allowlist_tokens_json;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .map((t: unknown) => String(t).trim().toLowerCase())
      .filter((t) => /^0x[a-fA-F0-9]{40}$/.test(t));
  } catch {
    return null;
  }
}

export interface ClaimDimensionInput {
  targetWeightsLength: number;
  fundAllowlistTokens: string[] | null;
}

export type ClaimValidationResult =
  | { ok: true }
  | { ok: false; code: string; message: string; detail: Record<string, unknown> };

export function validateClaimDimensions(
  input: ClaimDimensionInput
): ClaimValidationResult {
  const { targetWeightsLength, fundAllowlistTokens } = input;

  if (!fundAllowlistTokens || fundAllowlistTokens.length === 0) {
    return { ok: true };
  }

  if (targetWeightsLength === 0) {
    return {
      ok: false,
      code: "EMPTY_TARGET_WEIGHTS",
      message: "targetWeights must not be empty",
      detail: { expectedLength: fundAllowlistTokens.length, receivedLength: 0 }
    };
  }

  if (targetWeightsLength !== fundAllowlistTokens.length) {
    return {
      ok: false,
      code: "DIMENSION_MISMATCH",
      message: `targetWeights length (${targetWeightsLength}) must match fund allowlist token count (${fundAllowlistTokens.length})`,
      detail: {
        expectedLength: fundAllowlistTokens.length,
        receivedLength: targetWeightsLength
      }
    };
  }

  return { ok: true };
}
