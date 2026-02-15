export function intifyNumberScores(scores: number[], scale: bigint): bigint[] {
  if (scores.length === 0) throw new Error('scores must be non-empty');
  const safe = scores.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const sum = safe.reduce((acc, v) => acc + v, 0);

  if (sum <= 0) {
    const base = scale / BigInt(scores.length);
    const out = Array.from({ length: scores.length }, () => base);
    const rem = scale - out.reduce((a, b) => a + b, 0n);
    out[0] += rem;
    return out;
  }

  const out = safe.map((v) => {
    const w = (Number(scale) * v) / sum;
    if (!Number.isFinite(w) || w < 0) return 0n;
    return BigInt(Math.floor(w));
  });

  const rem = scale - out.reduce((a, b) => a + b, 0n);
  out[0] += rem;
  return out;
}

export function intifyBigintScores(scores: bigint[], scale: bigint): bigint[] {
  if (scores.length === 0) throw new Error('scores must be non-empty');
  const safe = scores.map((v) => (v > 0n ? v : 0n));
  const sum = safe.reduce((acc, v) => acc + v, 0n);

  if (sum <= 0n) {
    const base = scale / BigInt(scores.length);
    const out = Array.from({ length: scores.length }, () => base);
    const rem = scale - out.reduce((a, b) => a + b, 0n);
    out[0] += rem;
    return out;
  }

  const out = safe.map((v) => (scale * v) / sum);
  const rem = scale - out.reduce((a, b) => a + b, 0n);
  out[0] += rem;
  return out;
}

