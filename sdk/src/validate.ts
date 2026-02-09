const UINT16_MAX = (1n << 16n) - 1n;
const UINT64_MAX = (1n << 64n) - 1n;

export function assertUint16(value: bigint, label: string): void {
  if (value < 0n || value > UINT16_MAX) {
    throw new Error(`${label} must be uint16`);
  }
}

export function assertUint64(value: bigint, label: string): void {
  if (value < 0n || value > UINT64_MAX) {
    throw new Error(`${label} must be uint64`);
  }
}
