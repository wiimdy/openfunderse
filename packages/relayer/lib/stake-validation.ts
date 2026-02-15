export interface StakeWeightInputRaw {
  participant: string;
  weight: string;
}

export type StakeValidationResult =
  | { ok: true; participant: string; weight: bigint }
  | { ok: false; message: string };

export function validateStakeWeightInput(
  input: StakeWeightInputRaw
): StakeValidationResult {
  const participant = input.participant.trim().toLowerCase();
  if (!/^0x[a-fA-F0-9]{40}$/.test(participant)) {
    return { ok: false, message: "participant must be a valid 20-byte hex address" };
  }

  let weight: bigint;
  try {
    weight = BigInt(input.weight);
  } catch {
    return { ok: false, message: "weight must be a valid integer" };
  }

  if (weight < BigInt(0)) {
    return { ok: false, message: "weight must be non-negative" };
  }

  return { ok: true, participant, weight };
}
