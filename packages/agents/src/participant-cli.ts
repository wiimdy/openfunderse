import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { RelayerClientOptions } from './lib/relayer-client.js';
import {
  proposeAllocation,
  submitAllocation,
  validateAllocationOrIntent,
  type ProposeAllocationObservation
} from './skills/participant/index.js';

interface ParsedCli {
  command?: string;
  options: Map<string, string>;
  flags: Set<string>;
}

const parseCli = (argv: string[]): ParsedCli => {
  const [command, ...rest] = argv;
  const options = new Map<string, string>();
  const flags = new Set<string>();

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    if (key.includes('=')) {
      const [left, ...right] = key.split('=');
      options.set(left, right.join('='));
      continue;
    }
    const next = rest[i + 1];
    if (next && !next.startsWith('--')) {
      options.set(key, next);
      i += 1;
      continue;
    }
    flags.add(key);
  }
  return { command, options, flags };
};

const requiredOption = (parsed: ParsedCli, key: string): string => {
  const value = parsed.options.get(key);
  if (!value) {
    throw new Error(`missing required option --${key}`);
  }
  return value;
};

const optionOrDefault = (
  parsed: ParsedCli,
  key: string,
  fallback: string
): string => {
  return parsed.options.get(key) ?? fallback;
};

const toNumberOption = (
  parsed: ParsedCli,
  key: string,
  fallback: number
): number => {
  const raw = parsed.options.get(key);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`--${key} must be a number`);
  }
  return Math.trunc(value);
};

const jsonStringify = (value: unknown): string => {
  return JSON.stringify(
    value,
    (_key, inner) => (typeof inner === 'bigint' ? inner.toString() : inner),
    2
  );
};

const writeJsonFile = async (
  filePath: string,
  payload: unknown
): Promise<void> => {
  const absolute = resolve(filePath);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, jsonStringify(payload));
};

const readJsonFile = async <T>(filePath: string): Promise<T> => {
  const absolute = resolve(filePath);
  const raw = await readFile(absolute, 'utf8');
  return JSON.parse(raw) as T;
};

const buildClientOptionsForPrefix = (prefix: string): RelayerClientOptions | undefined => {
  const botId = process.env[`${prefix}_BOT_ID`];
  const privateKey = process.env[`${prefix}_PRIVATE_KEY`];
  const botAddress =
    process.env[`${prefix}_ADDRESS`] ?? process.env[`${prefix}_BOT_ADDRESS`];

  if (!botId && !privateKey && !botAddress) {
    return undefined;
  }
  if (!botId || !privateKey) {
    throw new Error(
      `${prefix}_BOT_ID and ${prefix}_PRIVATE_KEY must be set together`
    );
  }

  return {
    botId,
    privateKey: privateKey as `0x${string}`,
    botAddress: botAddress as `0x${string}` | undefined
  };
};

const buildDefaultBotClientOptions = (): RelayerClientOptions | undefined => {
  const botId = process.env.BOT_ID;
  const privateKey = process.env.PARTICIPANT_PRIVATE_KEY;
  const botAddress =
    process.env.PARTICIPANT_ADDRESS ?? process.env.PARTICIPANT_BOT_ADDRESS;

  if (!botId && !privateKey && !botAddress) {
    return undefined;
  }
  if (!botId || !privateKey) {
    throw new Error('BOT_ID and PARTICIPANT_PRIVATE_KEY must be set together');
  }

  return {
    botId,
    privateKey: privateKey as `0x${string}`,
    botAddress: botAddress as `0x${string}` | undefined
  };
};

const buildParticipantClientOptions = (): RelayerClientOptions | undefined => {
  const scoped = buildClientOptionsForPrefix('PARTICIPANT');
  if (scoped) {
    return scoped;
  }
  return buildDefaultBotClientOptions();
};

const parseTargetWeights = (raw: string): Array<string | number | bigint> => {
  const tokens = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    throw new Error('--target-weights must contain at least one integer');
  }
  return tokens.map((token) => {
    try {
      return BigInt(token);
    } catch {
      throw new Error(`invalid target weight: ${token}`);
    }
  });
};

const observationToClaimPayload = (
  observation: ProposeAllocationObservation
): Record<string, unknown> => {
  return observation.canonicalClaim as unknown as Record<string, unknown>;
};

const readObservationFromFile = async (
  claimFile: string
): Promise<{ fundId: string; epochId: number; observation: ProposeAllocationObservation }> => {
  const parsed = await readJsonFile<Record<string, unknown>>(claimFile);
  if (parsed.observation) {
    const observation = parsed.observation as ProposeAllocationObservation;
    const fundId = String(parsed.fundId ?? '');
    const epochId = Number(parsed.epochId ?? 0);
    if (!fundId || !Number.isFinite(epochId)) {
      throw new Error('claim file is missing fundId/epochId');
    }
    return { fundId, epochId: Math.trunc(epochId), observation };
  }
  if (parsed.claimHash && parsed.canonicalClaim) {
    const observation = parsed as unknown as ProposeAllocationObservation;
    const fundId = String(parsed.fundId ?? '');
    const epochId = Number(parsed.epochId ?? 0);
    if (!fundId || !Number.isFinite(epochId)) {
      throw new Error('observation file is missing fundId/epochId');
    }
    return { fundId, epochId: Math.trunc(epochId), observation };
  }
  throw new Error('unsupported claim file format');
};

const runParticipantProposeAllocation = async (parsed: ParsedCli): Promise<void> => {
  const fundId = requiredOption(parsed, 'fund-id');
  const epochId = Number(requiredOption(parsed, 'epoch-id'));
  if (!Number.isFinite(epochId)) {
    throw new Error('--epoch-id must be a number');
  }

  const output = await proposeAllocation({
    taskType: 'propose_allocation',
    fundId,
    roomId: optionOrDefault(parsed, 'room-id', 'participant-room'),
    epochId: Math.trunc(epochId),
    allocation: {
      participant: parsed.options.get('participant'),
      targetWeights: parseTargetWeights(requiredOption(parsed, 'target-weights')),
      horizonSec: toNumberOption(parsed, 'horizon-sec', 3600),
      nonce: parsed.options.has('nonce')
        ? toNumberOption(parsed, 'nonce', Math.trunc(Date.now() / 1000))
        : undefined
    }
  });

  console.log(jsonStringify(output));
  const outFile = parsed.options.get('out-file');
  if (outFile) {
    await writeJsonFile(outFile, output);
  }
  if (output.status !== 'OK') {
    process.exitCode = 2;
  }
};

const runParticipantValidateAllocation = async (parsed: ParsedCli): Promise<void> => {
  const claimFile = requiredOption(parsed, 'claim-file');
  const bundle = await readObservationFromFile(claimFile);
  const output = await validateAllocationOrIntent({
    taskType: 'validate_allocation_or_intent',
    fundId: bundle.fundId,
    roomId: optionOrDefault(parsed, 'room-id', 'participant-room'),
    epochId: bundle.epochId,
    subjectType: 'CLAIM',
    subjectHash: bundle.observation.claimHash,
    subjectPayload: observationToClaimPayload(bundle.observation),
    validationPolicy: {
      reproducible: true,
      maxDataAgeSeconds: toNumberOption(parsed, 'max-data-age-seconds', 300)
    }
  });

  console.log(jsonStringify(output));
  const outFile = parsed.options.get('out-file');
  if (outFile) {
    await writeJsonFile(outFile, output);
  }
  if (output.verdict !== 'PASS') {
    process.exitCode = 2;
  }
};

const runParticipantSubmitAllocation = async (parsed: ParsedCli): Promise<void> => {
  const claimFile = requiredOption(parsed, 'claim-file');
  const bundle = await readObservationFromFile(claimFile);
  const submitRequested = parsed.flags.has('submit');
  const output = await submitAllocation({
    fundId: bundle.fundId,
    epochId: bundle.epochId,
    observation: bundle.observation,
    clientOptions: buildParticipantClientOptions(),
    submit: submitRequested
  });
  console.log(jsonStringify(output));
  if (output.status !== 'OK') {
    process.exitCode = 2;
  }
};

const runParticipantE2E = async (parsed: ParsedCli): Promise<void> => {
  const fundId = requiredOption(parsed, 'fund-id');
  const epochId = Number(requiredOption(parsed, 'epoch-id'));
  const submitRequested = parsed.flags.has('submit');
  if (!Number.isFinite(epochId)) {
    throw new Error('--epoch-id must be a number');
  }

  const mine = await proposeAllocation({
    taskType: 'propose_allocation',
    fundId,
    roomId: optionOrDefault(parsed, 'room-id', 'participant-room'),
    epochId: Math.trunc(epochId),
    allocation: {
      participant: parsed.options.get('participant'),
      targetWeights: parseTargetWeights(requiredOption(parsed, 'target-weights')),
      horizonSec: toNumberOption(parsed, 'horizon-sec', 3600),
      nonce: parsed.options.has('nonce')
        ? toNumberOption(parsed, 'nonce', Math.trunc(Date.now() / 1000))
        : undefined
    }
  });
  if (mine.status !== 'OK' || !mine.observation) {
    console.log(jsonStringify({ step: 'mine', result: mine }));
    process.exitCode = 2;
    return;
  }

  const verify = await validateAllocationOrIntent({
    taskType: 'validate_allocation_or_intent',
    fundId,
    roomId: optionOrDefault(parsed, 'room-id', 'participant-room'),
    epochId: Math.trunc(epochId),
    subjectType: 'CLAIM',
    subjectHash: mine.observation.claimHash,
    subjectPayload: observationToClaimPayload(mine.observation),
    validationPolicy: {
      reproducible: true,
      maxDataAgeSeconds: toNumberOption(parsed, 'max-data-age-seconds', 300)
    }
  });
  if (verify.verdict !== 'PASS') {
    console.log(jsonStringify({ step: 'verify', result: verify }));
    process.exitCode = 2;
    return;
  }

  const submit = await submitAllocation({
    fundId,
    epochId: Math.trunc(epochId),
    observation: mine.observation,
    clientOptions: buildParticipantClientOptions(),
    submit: submitRequested
  });
  if (submit.status !== 'OK' || !submit.claimHash) {
    console.log(jsonStringify({ step: 'submit', result: submit }));
    process.exitCode = 2;
    return;
  }

  const report = {
    step: 'participant-allocation-e2e',
    mode: submit.decision === 'SUBMITTED' ? 'SUBMITTED' : 'READY',
    fundId,
    epochId: Math.trunc(epochId),
    claimHash: submit.claimHash,
    mine,
    verify,
    submit,
    finalize:
      submit.decision === 'SUBMITTED'
        ? undefined
        : {
            status: 'SKIPPED',
            reason:
              'participant submit gate is not enabled; pass --submit and set PARTICIPANT_AUTO_SUBMIT=true'
          }
  };

  console.log(jsonStringify(report));

  const reportFile = parsed.options.get('report-file');
  if (reportFile) {
    await writeJsonFile(reportFile, report);
  }
};

const printUsage = (): void => {
  console.log(`
[agents] participant commands

participant-propose-allocation
  --fund-id <id> --epoch-id <n> --target-weights <w1,w2,...>
  [--participant <0x...>] [--horizon-sec <n>] [--nonce <n>] [--room-id <id>] [--out-file <path>]

participant-validate-allocation
  --claim-file <path>
  [--max-data-age-seconds <n>] [--out-file <path>]

participant-submit-allocation
  --claim-file <path> [--submit]

participant-allocation-e2e
  --fund-id <id> --epoch-id <n> --target-weights <w1,w2,...>
  [--participant <0x...>] [--horizon-sec <n>] [--report-file <path>] [--submit]
`);
};

export const runParticipantCli = async (argv: string[]): Promise<boolean> => {
  const parsed = parseCli(argv);
  const command = parsed.command ?? '';
  if (!command.startsWith('participant-')) {
    return false;
  }

  if (parsed.flags.has('help') || command === 'participant-help') {
    printUsage();
    return true;
  }

  if (command === 'participant-propose-allocation') {
    await runParticipantProposeAllocation(parsed);
    return true;
  }
  if (command === 'participant-validate-allocation') {
    await runParticipantValidateAllocation(parsed);
    return true;
  }
  if (command === 'participant-submit-allocation') {
    await runParticipantSubmitAllocation(parsed);
    return true;
  }
  if (command === 'participant-allocation-e2e') {
    await runParticipantE2E(parsed);
    return true;
  }

  throw new Error(`unknown participant command: ${command}`);
};
