export const DEFAULT_FUND_ALLOWLIST_TOKENS: string[] = [
  // ZEN (Zen)
  "0x02300a68a6ca7e65fd0fd95b17108f2ac7867777",
  // tFOMA (FoMA Test Token)
  "0x0b8fe534ab0f6bf6a09e92bb1f260cadd7587777",
  // MONAI (Monad AI)
  "0xdd551bcf21362d182f9426153e80e2c5f6b47777",
  // PFROG (Purple Frog)
  "0x01da4a82d3e29d2fcc174be63d50b9a486e47777",
  // NADOG (NadFun Doge)
  "0x0b038fcf9765a4b14d649d340a809324d6537777",
  // GMON (Giga Monad)
  "0x8bf6bdbf758f55687d7e155d68ae3ed811167777"
].map((t) => t.trim().toLowerCase());

export function resolveFundAllowlistTokens(input: {
  requestedAllowlistTokens: string[] | undefined;
  existingAllowlistTokensJson: string | null | undefined;
}): string[] | undefined {
  if (input.requestedAllowlistTokens !== undefined) {
    return input.requestedAllowlistTokens;
  }
  // Avoid overwriting an existing fund's allowlist on subsequent sync calls.
  if (input.existingAllowlistTokensJson != null) {
    return undefined;
  }
  return DEFAULT_FUND_ALLOWLIST_TOKENS;
}

