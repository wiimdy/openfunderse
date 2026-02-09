export function unixNow(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

export function isExpired(expiresAt: bigint, now: bigint = unixNow()): boolean {
  return expiresAt <= now;
}

export function assertNotExpired(expiresAt: bigint, now: bigint = unixNow()): void {
  if (isExpired(expiresAt, now)) {
    throw new Error(`signature expired: expiresAt=${expiresAt.toString(10)}, now=${now.toString(10)}`);
  }
}

export function assertNonceStrictlyIncreases(lastNonce: bigint | null, incomingNonce: bigint): void {
  if (lastNonce !== null && incomingNonce <= lastNonce) {
    throw new Error(
      `nonce must strictly increase: last=${lastNonce.toString(10)}, incoming=${incomingNonce.toString(10)}`
    );
  }
}
