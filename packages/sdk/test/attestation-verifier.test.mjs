import test from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import {
  intentAttestationTypedData,
  verifyIntentAttestationEnvelope,
  reachedThreshold
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

test("verifyIntentAttestationEnvelope success path", async () => {
  const message = {
    intentHash: "0xe9436fca64e752da73fe7e8912837041f27adef605c346a963c04db6ee3e70b3",
    verifier: account.address,
    expiresAt: 4102444800n,
    nonce: 10n
  };

  const signature = await account.signTypedData(intentAttestationTypedData(domain, message));
  const verified = await verifyIntentAttestationEnvelope(domain, message, signature);

  assert.equal(verified.ok, true);
  assert.equal(verified.recovered, account.address);
  assert.equal(typeof verified.digest, "string");
});

test("verifyIntentAttestationEnvelope fails for expired message", async () => {
  const message = {
    intentHash: "0xe9436fca64e752da73fe7e8912837041f27adef605c346a963c04db6ee3e70b3",
    verifier: account.address,
    expiresAt: 1n,
    nonce: 10n
  };

  const signature = await account.signTypedData(intentAttestationTypedData(domain, message));
  const verified = await verifyIntentAttestationEnvelope(domain, message, signature);

  assert.equal(verified.ok, false);
  assert.match(verified.error ?? "", /expired/i);
});

test("verifyIntentAttestationEnvelope fails for malformed signature without throwing", async () => {
  const message = {
    intentHash: "0xe9436fca64e752da73fe7e8912837041f27adef605c346a963c04db6ee3e70b3",
    verifier: account.address,
    expiresAt: 4102444800n,
    nonce: 11n
  };

  const verified = await verifyIntentAttestationEnvelope(domain, message, "0x1234");

  assert.equal(verified.ok, false);
  assert.equal(typeof verified.error, "string");
});

test("verifyIntentAttestationEnvelope fails when domain differs", async () => {
  const message = {
    intentHash: "0xe9436fca64e752da73fe7e8912837041f27adef605c346a963c04db6ee3e70b3",
    verifier: account.address,
    expiresAt: 4102444800n,
    nonce: 12n
  };

  const signature = await account.signTypedData(intentAttestationTypedData(domain, message));
  const wrongDomain = { ...domain, verifyingContract: "0x000000000000000000000000000000000000beef" };

  const verified = await verifyIntentAttestationEnvelope(wrongDomain, message, signature);

  assert.equal(verified.ok, false);
  assert.match(verified.error ?? "", /recover|signature/i);
});

test("reachedThreshold handles boundary and rejects invalid inputs", () => {
  assert.equal(reachedThreshold(0, 1), false);
  assert.equal(reachedThreshold(1, 1), true);
  assert.equal(reachedThreshold(5, 3), true);

  assert.throws(() => reachedThreshold(-1, 1));
  assert.throws(() => reachedThreshold(1.2, 1));
  assert.throws(() => reachedThreshold(1, 0));
  assert.throws(() => reachedThreshold(1, 1.5));
});
