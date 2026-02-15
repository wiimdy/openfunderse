import crypto from 'node:crypto';
import {
  intentAttestationTypedData,
  type Address,
  type Hex,
  type IntentAttestationMessage
} from '@claw/protocol-sdk';
import { privateKeyToAccount } from 'viem/accounts';

const INTENT_DOMAIN_NAME = 'ClawIntentBook';
const DOMAIN_VERSION = '1';

export async function signAuthMessage(
  privateKey: Hex,
  botId: string
): Promise<{ signature: Hex; timestamp: string; nonce: string }> {
  const account = privateKeyToAccount(privateKey);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID();
  const message = `openfunderse:auth:${botId}:${timestamp}:${nonce}`;
  const signature = await account.signMessage({ message });
  return { signature, timestamp, nonce };
}

export interface BootstrapAuthInput {
  fundId: string;
  txHash: Hex;
  strategyBotId: string;
  strategyBotAddress: Address;
}

export interface BootstrapAuth {
  signature: Hex;
  nonce: string;
  expiresAt: string;
}

export async function signBootstrapMessage(
  privateKey: Hex,
  input: BootstrapAuthInput
): Promise<BootstrapAuth> {
  const account = privateKeyToAccount(privateKey);
  const nonce = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + 300; // 5 minutes
  const message =
    `OpenFunderse fund bootstrap\\n` +
    `fundId=${input.fundId}\\n` +
    `txHash=${input.txHash}\\n` +
    `strategyBotId=${input.strategyBotId}\\n` +
    `strategyBotAddress=${input.strategyBotAddress}\\n` +
    `expiresAt=${expiresAt}\\n` +
    `nonce=${nonce}`;
  const signature = await account.signMessage({ message });
  return { signature, nonce, expiresAt: String(expiresAt) };
}

export interface BotSignerOptions {
  privateKey?: Hex;
  chainId?: bigint;
  intentBookAddress?: Address;
}

export interface SignedIntentAttestation {
  verifier: Address;
  signature: Hex;
  message: IntentAttestationMessage;
}

const readEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
};

const readFirstEnv = (names: string[]): string => {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.length > 0) {
      return value;
    }
  }
  throw new Error(`one of [${names.join(', ')}] is required`);
};

const parseBigIntOrThrow = (
  value: string | number | bigint | undefined,
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

export class BotSigner {
  private readonly account: ReturnType<typeof privateKeyToAccount>;
  private readonly chainId: bigint;
  private readonly intentBookAddress?: Address;

  constructor(options: BotSignerOptions = {}) {
    const privateKey =
      (options.privateKey ??
        readFirstEnv(['PARTICIPANT_PRIVATE_KEY', 'BOT_PRIVATE_KEY', 'VERIFIER_PRIVATE_KEY'])) as Hex;
    this.chainId = options.chainId ?? parseBigIntOrThrow(readEnv('CHAIN_ID'), 'CHAIN_ID');
    this.intentBookAddress =
      options.intentBookAddress ??
      (process.env.INTENT_BOOK_ADDRESS as Address | undefined);
    this.account = privateKeyToAccount(privateKey);
  }

  getVerifierAddress(): Address {
    return this.account.address;
  }

  async signIntentAttestation(input: {
    intentHash: Hex;
    expiresAt: bigint | number | string;
    nonce: bigint | number | string;
  }): Promise<SignedIntentAttestation> {
    if (!this.intentBookAddress) {
      throw new Error('INTENT_BOOK_ADDRESS is required for intent attestation signing');
    }
    const message: IntentAttestationMessage = {
      intentHash: input.intentHash,
      verifier: this.account.address,
      expiresAt: parseBigIntOrThrow(input.expiresAt, 'intent attestation expiresAt'),
      nonce: parseBigIntOrThrow(input.nonce, 'intent attestation nonce')
    };
    const signature = await this.account.signTypedData(
      intentAttestationTypedData(
        {
          name: INTENT_DOMAIN_NAME,
          version: DOMAIN_VERSION,
          chainId: this.chainId,
          verifyingContract: this.intentBookAddress
        },
        message
      )
    );
    return {
      verifier: this.account.address,
      signature,
      message
    };
  }
}

export const createBotSigner = (options: BotSignerOptions = {}): BotSigner => {
  return new BotSigner(options);
};
