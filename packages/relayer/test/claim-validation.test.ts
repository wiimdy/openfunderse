import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseFundAllowlistTokens,
  validateClaimDimensions
} from '../lib/claim-validation';

const TOKEN_A = '0x1111111111111111111111111111111111111111';
const TOKEN_B = '0x2222222222222222222222222222222222222222';

test('parseFundAllowlistTokens parses valid allowlist json', () => {
  const parsed = parseFundAllowlistTokens({
    allowlist_tokens_json: JSON.stringify([TOKEN_A, TOKEN_B])
  });
  assert.deepEqual(parsed, [TOKEN_A, TOKEN_B]);
});

test('parseFundAllowlistTokens returns null for null input', () => {
  const parsed = parseFundAllowlistTokens({ allowlist_tokens_json: null });
  assert.equal(parsed, null);
});

test('parseFundAllowlistTokens returns null for undefined input', () => {
  const parsed = parseFundAllowlistTokens({});
  assert.equal(parsed, null);
});

test('parseFundAllowlistTokens returns null for malformed json', () => {
  const parsed = parseFundAllowlistTokens({ allowlist_tokens_json: '{bad-json' });
  assert.equal(parsed, null);
});

test('parseFundAllowlistTokens returns null for non-array json', () => {
  const parsed = parseFundAllowlistTokens({
    allowlist_tokens_json: JSON.stringify({ token: TOKEN_A })
  });
  assert.equal(parsed, null);
});

test('parseFundAllowlistTokens normalizes and filters invalid entries', () => {
  const parsed = parseFundAllowlistTokens({
    allowlist_tokens_json: JSON.stringify(['  0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA  ', '0x1234', 42])
  });
  assert.deepEqual(parsed, ['0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']);
});

test('validateClaimDimensions passes when fund allowlist is null', () => {
  const result = validateClaimDimensions({ targetWeightsLength: 0, fundAllowlistTokens: null });
  assert.deepEqual(result, { ok: true });
});

test('validateClaimDimensions passes when fund allowlist is empty', () => {
  const result = validateClaimDimensions({ targetWeightsLength: 2, fundAllowlistTokens: [] });
  assert.deepEqual(result, { ok: true });
});

test('validateClaimDimensions passes when lengths match', () => {
  const result = validateClaimDimensions({
    targetWeightsLength: 2,
    fundAllowlistTokens: [TOKEN_A, TOKEN_B]
  });
  assert.deepEqual(result, { ok: true });
});

test('validateClaimDimensions rejects empty targetWeights for non-empty allowlist', () => {
  const result = validateClaimDimensions({ targetWeightsLength: 0, fundAllowlistTokens: [TOKEN_A] });
  assert.deepEqual(result, {
    ok: false,
    code: 'EMPTY_TARGET_WEIGHTS',
    message: 'targetWeights must not be empty',
    detail: { expectedLength: 1, receivedLength: 0 }
  });
});

test('validateClaimDimensions rejects mismatched lengths', () => {
  const result = validateClaimDimensions({
    targetWeightsLength: 1,
    fundAllowlistTokens: [TOKEN_A, TOKEN_B]
  });
  assert.deepEqual(result, {
    ok: false,
    code: 'DIMENSION_MISMATCH',
    message: 'targetWeights length (1) must match fund allowlist token count (2)',
    detail: { expectedLength: 2, receivedLength: 1 }
  });
});

test('validateClaimDimensions passes for single-token allowlist with one target weight', () => {
  const result = validateClaimDimensions({ targetWeightsLength: 1, fundAllowlistTokens: [TOKEN_A] });
  assert.deepEqual(result, { ok: true });
});
