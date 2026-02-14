import test from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import {
  intentAttestationTypedData,
  verifyIntentAttestation,
  intentAttestationDigest,
  recoverIntentAttester,
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

test("EIP-712 intent attestation sign/verify roundtrip", async () => {
  const message = {
    intentHash: "0xe9436fca64e752da73fe7e8912837041f27adef605c346a963c04db6ee3e70b3",
    verifier: account.address,
    expiresAt: 1739003600n,
    nonce: 1n
  };

  const typedData = intentAttestationTypedData(domain, message);
  const signature = await account.signTypedData(typedData);

  const ok = await verifyIntentAttestation(domain, message, signature);
  assert.equal(ok, true);

  const digest = intentAttestationDigest(domain, message);
  assert.equal(typeof digest, "string");
  assert.equal(digest.length, 66);
});

test("verify fails when verifier address does not match signature", async () => {
  const message = {
    intentHash: "0xe9436fca64e752da73fe7e8912837041f27adef605c346a963c04db6ee3e70b3",
    verifier: account.address,
    expiresAt: 1739003600n,
    nonce: 2n
  };

  const signature = await account.signTypedData(intentAttestationTypedData(domain, message));
  const wrongVerifier = {
    ...message,
    verifier: "0x000000000000000000000000000000000000dEaD"
  };
  const ok = await verifyIntentAttestation(domain, wrongVerifier, signature);
  assert.equal(ok, false);
});

test("verify fails when domain differs", async () => {
  const message = {
    intentHash: "0xe9436fca64e752da73fe7e8912837041f27adef605c346a963c04db6ee3e70b3",
    verifier: account.address,
    expiresAt: 1739003600n,
    nonce: 3n
  };

  const signature = await account.signTypedData(intentAttestationTypedData(domain, message));
  const wrongDomain = { ...domain, chainId: domain.chainId + 1n };
  const ok = await verifyIntentAttestation(wrongDomain, message, signature);
  assert.equal(ok, false);
});

test("verify fails when message differs", async () => {
  const message = {
    intentHash: "0xe9436fca64e752da73fe7e8912837041f27adef605c346a963c04db6ee3e70b3",
    verifier: account.address,
    expiresAt: 1739003600n,
    nonce: 4n
  };
  const signature = await account.signTypedData(intentAttestationTypedData(domain, message));
  const tampered = { ...message, nonce: 5n };
  const ok = await verifyIntentAttestation(domain, tampered, signature);
  assert.equal(ok, false);
});

test("recover intent attester", async () => {
  const message = {
    intentHash: "0xe9436fca64e752da73fe7e8912837041f27adef605c346a963c04db6ee3e70b3",
    verifier: account.address,
    expiresAt: 1739003600n,
    nonce: 7n
  };
  const signature = await account.signTypedData(intentAttestationTypedData(domain, message));
  assert.equal(await recoverIntentAttester(domain, message, signature), account.address);
});

test("replay guards: expiry and monotonic nonce", () => {
  assert.throws(() => assertNotExpired(100n, 101n));
  assert.throws(() => assertNotExpired(101n, 101n));
  assert.doesNotThrow(() => assertNotExpired(101n, 101n - 1n));

  assert.doesNotThrow(() => assertNonceStrictlyIncreases(5n, 6n));
  assert.doesNotThrow(() => assertNonceStrictlyIncreases(null, 0n));
  assert.throws(() => assertNonceStrictlyIncreases(5n, 5n));
  assert.throws(() => assertNonceStrictlyIncreases(5n, 4n));
});
