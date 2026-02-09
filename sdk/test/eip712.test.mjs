import test from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import {
  claimAttestationTypedData,
  verifyClaimAttestation,
  claimAttestationDigest,
  assertNotExpired,
  assertNonceStrictlyIncreases
} from "../dist/index.js";

const domain = {
  name: "ClawProtocol",
  version: "1",
  chainId: 10143n,
  verifyingContract: "0x0000000000000000000000000000000000000a11"
};

const account = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945382db1f95b35f5f12956f10f77c34700f3d"
);

test("EIP-712 claim attestation sign/verify roundtrip", async () => {
  const message = {
    claimHash: "0x3aad4f1da71a80fccb5d5842524dd1f8cf23b1e072fc6d74860abd0f0246b3ae",
    epochId: 12n,
    verifier: account.address,
    expiresAt: 1739003600n,
    nonce: 1n
  };

  const typedData = claimAttestationTypedData(domain, message);
  const signature = await account.signTypedData(typedData);

  const ok = await verifyClaimAttestation(domain, message, signature);
  assert.equal(ok, true);

  const digest = claimAttestationDigest(domain, message);
  assert.equal(typeof digest, "string");
  assert.equal(digest.length, 66);
});

test("verify fails when verifier address does not match signature", async () => {
  const message = {
    claimHash: "0x3aad4f1da71a80fccb5d5842524dd1f8cf23b1e072fc6d74860abd0f0246b3ae",
    epochId: 12n,
    verifier: account.address,
    expiresAt: 1739003600n,
    nonce: 2n
  };

  const signature = await account.signTypedData(claimAttestationTypedData(domain, message));
  const wrongVerifier = {
    ...message,
    verifier: "0x000000000000000000000000000000000000dEaD"
  };
  const ok = await verifyClaimAttestation(domain, wrongVerifier, signature);
  assert.equal(ok, false);
});

test("replay guards: expiry and monotonic nonce", () => {
  assert.throws(() => assertNotExpired(100n, 101n));
  assert.doesNotThrow(() => assertNotExpired(101n, 101n - 1n));

  assert.doesNotThrow(() => assertNonceStrictlyIncreases(5n, 6n));
  assert.throws(() => assertNonceStrictlyIncreases(5n, 5n));
});
