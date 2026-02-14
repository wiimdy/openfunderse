import {
  claimAttestationTypedData,
  intentAttestationTypedData,
  type Address,
  type ClaimAttestationMessage,
  type Hex,
  type IntentAttestationMessage
} from '@claw/protocol-sdk';
import { privateKeyToAccount } from 'viem/accounts';

const CLAIM_DOMAIN_NAME = 'ClawClaimBook';
const INTENT_DOMAIN_NAME = 'ClawIntentBook';
const DOMAIN_VERSION = '1';

export interface BotSignerOptions {
  privateKey?: Hex;
  chainId?: bigint;
  claimBookAddress?: Address;
  intentBookAddress?: Address;
}

export interface SignedClaimAttestation {
  verifier: Address;
  signature: Hex;
  message: ClaimAttestationMessage;
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
  private readonly claimBookAddress: Address;
  private readonly intentBookAddress: Address;

  constructor(options: BotSignerOptions = {}) {
    const privateKey = (options.privateKey ?? readEnv('BOT_PRIVATE_KEY')) as Hex;
    this.chainId =
      options.chainId ?? parseBigIntOrThrow(readEnv('CHAIN_ID'), 'CHAIN_ID');
    this.claimBookAddress =
      options.claimBookAddress ?? (readEnv('CLAIM_BOOK_ADDRESS') as Address);
    this.intentBookAddress =
      options.intentBookAddress ?? (readEnv('INTENT_BOOK_ADDRESS') as Address);
    this.account = privateKeyToAccount(privateKey);
  }

  getVerifierAddress(): Address {
    return this.account.address;
  }

  async signClaimAttestation(input: {
    claimHash: Hex;
    epochId: bigint | number | string;
    expiresAt: bigint | number | string;
    nonce: bigint | number | string;
  }): Promise<SignedClaimAttestation> {
    const message: ClaimAttestationMessage = {
      claimHash: input.claimHash,
      epochId: parseBigIntOrThrow(input.epochId, 'claim attestation epochId'),
      verifier: this.account.address,
      expiresAt: parseBigIntOrThrow(input.expiresAt, 'claim attestation expiresAt'),
      nonce: parseBigIntOrThrow(input.nonce, 'claim attestation nonce')
    };
    const signature = await this.account.signTypedData(
      claimAttestationTypedData(
        {
          name: CLAIM_DOMAIN_NAME,
          version: DOMAIN_VERSION,
          chainId: this.chainId,
          verifyingContract: this.claimBookAddress
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

  async signIntentAttestation(input: {
    intentHash: Hex;
    expiresAt: bigint | number | string;
    nonce: bigint | number | string;
  }): Promise<SignedIntentAttestation> {
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
