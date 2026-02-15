export interface ClaimEntry {
  participant: string;
  weights: bigint[];
  claimHash: string;
}

export interface AggregateFilterInput {
  claims: ClaimEntry[];
  registeredParticipants: Set<string>;
  stakeMap: Map<string, bigint>;
  expectedDimensions: number | null;
}

export interface FilteredClaim extends ClaimEntry {
  stake: bigint;
}

export interface AggregateFilterOutput {
  included: FilteredClaim[];
  skipped: {
    unregistered: string[];
    noStake: string[];
    dimensionMismatch: string[];
  };
}

export function filterAndWeighClaims(
  input: AggregateFilterInput
): AggregateFilterOutput {
  const { claims, registeredParticipants, stakeMap, expectedDimensions } = input;
  const included: FilteredClaim[] = [];
  const skipped = {
    unregistered: [] as string[],
    noStake: [] as string[],
    dimensionMismatch: [] as string[]
  };

  let resolvedDim = expectedDimensions;

  for (const claim of claims) {
    const key = claim.participant.toLowerCase();

    if (!registeredParticipants.has(key)) {
      skipped.unregistered.push(key);
      continue;
    }

    const stake = stakeMap.get(key) ?? BigInt(0);
    if (stake <= BigInt(0)) {
      skipped.noStake.push(key);
      continue;
    }

    if (resolvedDim === null) {
      resolvedDim = claim.weights.length;
    }
    if (claim.weights.length !== resolvedDim) {
      skipped.dimensionMismatch.push(key);
      continue;
    }

    included.push({ ...claim, stake });
  }

  return { included, skipped };
}

export function computeStakeWeightedAggregate(
  participants: Array<{ weights: bigint[]; stake: bigint }>,
  dimensions: number
): bigint[] {
  if (participants.length === 0) {
    throw new Error("cannot compute aggregate with zero participants");
  }

  let totalStake = BigInt(0);
  for (const p of participants) {
    totalStake += p.stake;
  }
  if (totalStake <= BigInt(0)) {
    throw new Error("total stake must be positive");
  }

  const aggregate = Array.from({ length: dimensions }, () => BigInt(0));
  for (const p of participants) {
    for (let i = 0; i < dimensions; i++) {
      aggregate[i] += p.weights[i] * p.stake;
    }
  }

  const result = aggregate.map((n) => n / totalStake);

  const claimScale = participants[0].weights.reduce((a, b) => a + b, BigInt(0));
  const resultSum = result.reduce((a, b) => a + b, BigInt(0));
  const remainder = claimScale - resultSum;
  if (remainder !== BigInt(0) && result.length > 0) {
    result[0] += remainder;
  }

  return result;
}
