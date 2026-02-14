import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  intentAttestationTypedData
} from "@claw/protocol-sdk";
import { privateKeyToAccount } from "viem/accounts";

function env(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing env: ${name}`);
  }
  return value;
}

function asBigInt(name, fallback) {
  const raw = env(name, fallback);
  try {
    return BigInt(raw);
  } catch {
    throw new Error(`invalid bigint env: ${name}=${raw}`);
  }
}

const signerKey = env("PARTICIPANT_PRIVATE_KEY", env("VERIFIER_PRIVATE_KEY", env("RELAYER_SIGNER_PRIVATE_KEY", "0x")));
if (signerKey === "0x") {
  throw new Error("set PARTICIPANT_PRIVATE_KEY (or RELAYER_SIGNER_PRIVATE_KEY) to generate signatures");
}

const account = privateKeyToAccount(signerKey);
const chainId = asBigInt("CHAIN_ID", "10143");
const intentBookAddress = env("INTENT_BOOK_ADDRESS");
const intentHash = env(
  "INTENT_HASH",
  "0x2222222222222222222222222222222222222222222222222222222222222222"
);
const intentNonce = asBigInt("INTENT_NONCE", "2");
const now = BigInt(Math.floor(Date.now() / 1000));
const intentExpiresAt = asBigInt("INTENT_EXPIRES_AT", (now + BigInt(3600)).toString());

const verifier = account.address;

const intentDomain = {
  name: "ClawIntentBook",
  version: "1",
  chainId,
  verifyingContract: intentBookAddress
};

const intentMessage = {
  intentHash,
  verifier,
  expiresAt: intentExpiresAt,
  nonce: intentNonce
};

const intentSignature = await account.signTypedData(intentAttestationTypedData(intentDomain, intentMessage));

const intentFixture = {
  attestations: [
    {
      intentHash,
      verifier,
      expiresAt: intentExpiresAt.toString(),
      nonce: intentNonce.toString(),
      signature: intentSignature
    }
  ]
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "fixtures");
fs.mkdirSync(fixturesDir, { recursive: true });

fs.writeFileSync(path.join(fixturesDir, "intent-attestation-batch.json"), JSON.stringify(intentFixture, null, 2));

console.log("Generated fixtures:");
console.log(`- ${path.join(fixturesDir, "intent-attestation-batch.json")}`);
console.log("\nSet these Postman environment values:");
console.log(`participant_address=${verifier}`);
console.log(`intent_hash=${intentHash}`);
console.log(`intent_expires_at=${intentExpiresAt.toString()}`);
console.log(`intent_nonce=${intentNonce.toString()}`);
console.log(`intent_signature=${intentSignature}`);
