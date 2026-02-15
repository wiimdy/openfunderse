import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_FUND_ALLOWLIST_TOKENS, resolveFundAllowlistTokens } from "../lib/fund-defaults";

test("resolveFundAllowlistTokens returns requested tokens when provided", () => {
  const out = resolveFundAllowlistTokens({
    requestedAllowlistTokens: ["0x1111111111111111111111111111111111111111"],
    existingAllowlistTokensJson: null
  });
  assert.deepEqual(out, ["0x1111111111111111111111111111111111111111"]);
});

test("resolveFundAllowlistTokens defaults tokens when no request and no existing allowlist", () => {
  const out = resolveFundAllowlistTokens({
    requestedAllowlistTokens: undefined,
    existingAllowlistTokensJson: null
  });
  assert.deepEqual(out, DEFAULT_FUND_ALLOWLIST_TOKENS);
});

test("resolveFundAllowlistTokens avoids overwriting when existing allowlist json is present", () => {
  const out = resolveFundAllowlistTokens({
    requestedAllowlistTokens: undefined,
    existingAllowlistTokensJson: "[]"
  });
  assert.equal(out, undefined);
});

