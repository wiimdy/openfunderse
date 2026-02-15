import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { RelayerClientOptions } from './lib/relayer-client.js';
import { createRelayerClient } from './lib/relayer-client.js';
import { createMonadTestnetPublicClient } from './strategies/nadfun/client.js';
import { computeTargetWeights, type ParticipantStrategyId } from './strategies/participant/strategies.js';
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

const parseEpochId = (parsed: ParsedCli): number => {
  const epochId = Number(requiredOption(parsed, 'epoch-id'));
  if (!Number.isFinite(epochId)) {
    throw new Error('--epoch-id must be a number');
  }
  return Math.trunc(epochId);
};

const proposeAllocationFromParsed = async (
  parsed: ParsedCli
): Promise<{ fundId: string; epochId: number; mine: Awaited<ReturnType<typeof proposeAllocation>> }> => {
  const fundId = requiredOption(parsed, 'fund-id');
  const epochId = parseEpochId(parsed);

  const mine = await proposeAllocation({
    taskType: 'propose_allocation',
    fundId,
    roomId: optionOrDefault(parsed, 'room-id', 'participant-room'),
    epochId,
    allocation: {
      participant: parsed.options.get('participant'),
      targetWeights: parseTargetWeights(requiredOption(parsed, 'target-weights')),
      horizonSec: toNumberOption(parsed, 'horizon-sec', 3600),
      nonce: parsed.options.has('nonce')
        ? toNumberOption(parsed, 'nonce', Math.trunc(Date.now() / 1000))
        : undefined
    }
  });

  return { fundId, epochId, mine };
};

type ParticipantAllocationMode = 'MINE_AND_SUBMIT' | 'SUBMIT_FROM_FILE';

const runParticipantAllocation = async (
  parsed: ParsedCli,
  config?: { forceVerify?: boolean; stepName?: string }
): Promise<void> => {
  const submitRequested = parsed.flags.has('submit');
  const verifyRequested = Boolean(config?.forceVerify) || parsed.flags.has('verify');
  const stepName = config?.stepName ?? 'participant-allocation';

  const claimFile = parsed.options.get('claim-file');
  const mode: ParticipantAllocationMode = claimFile ? 'SUBMIT_FROM_FILE' : 'MINE_AND_SUBMIT';

  let mine:
    | Awaited<ReturnType<typeof proposeAllocation>>
    | undefined;
  let verify:
    | Awaited<ReturnType<typeof validateAllocationOrIntent>>
    | undefined;
  let submit:
    | Awaited<ReturnType<typeof submitAllocation>>
    | undefined;

  let fundId = '';
  let epochId = 0;
  let claimHash: string | undefined;

  if (mode === 'SUBMIT_FROM_FILE') {
    const bundle = await readObservationFromFile(claimFile as string);
    fundId = bundle.fundId;
    epochId = bundle.epochId;
    claimHash = bundle.observation.claimHash;

    if (verifyRequested) {
      verify = await validateAllocationOrIntent({
        taskType: 'validate_allocation_or_intent',
        fundId,
        roomId: optionOrDefault(parsed, 'room-id', 'participant-room'),
        epochId,
        subjectType: 'CLAIM',
        subjectHash: bundle.observation.claimHash,
        subjectPayload: observationToClaimPayload(bundle.observation),
        validationPolicy: {
          reproducible: true,
          maxDataAgeSeconds: toNumberOption(parsed, 'max-data-age-seconds', 300)
        }
      });
      if (verify.verdict !== 'PASS') {
        const result = {
          step: stepName,
          mode,
          fundId,
          epochId,
          claimHash,
          observation: bundle.observation,
          verify
        };
        console.log(jsonStringify(result));
        const outFile = parsed.options.get('out-file');
        if (outFile) await writeJsonFile(outFile, result);
        const reportFile = parsed.options.get('report-file');
        if (reportFile) await writeJsonFile(reportFile, result);
        process.exitCode = 2;
        return;
      }
    }

    submit = await submitAllocation({
      fundId,
      epochId,
      observation: bundle.observation,
      clientOptions: buildParticipantClientOptions(),
      submit: submitRequested
    });

    const result = {
      step: stepName,
      mode,
      fundId,
      epochId,
      claimHash: submit.claimHash ?? claimHash,
      observation: bundle.observation,
      verify,
      submit
    };

    console.log(jsonStringify(result));
    const outFile = parsed.options.get('out-file');
    if (outFile) await writeJsonFile(outFile, result);
    const reportFile = parsed.options.get('report-file');
    if (reportFile) await writeJsonFile(reportFile, result);
    if (submit.status !== 'OK') {
      process.exitCode = 2;
    }
    return;
  }

  const proposed = await proposeAllocationFromParsed(parsed);
  fundId = proposed.fundId;
  epochId = proposed.epochId;
  mine = proposed.mine;

  if (mine.status !== 'OK' || !mine.observation) {
    const result = { step: stepName, mode, fundId, epochId, mine };
    console.log(jsonStringify(result));
    const outFile = parsed.options.get('out-file');
    if (outFile) await writeJsonFile(outFile, result);
    const reportFile = parsed.options.get('report-file');
    if (reportFile) await writeJsonFile(reportFile, result);
    process.exitCode = 2;
    return;
  }

  claimHash = mine.observation.claimHash;

  if (verifyRequested) {
    verify = await validateAllocationOrIntent({
      taskType: 'validate_allocation_or_intent',
      fundId,
      roomId: optionOrDefault(parsed, 'room-id', 'participant-room'),
      epochId,
      subjectType: 'CLAIM',
      subjectHash: mine.observation.claimHash,
      subjectPayload: observationToClaimPayload(mine.observation),
      validationPolicy: {
        reproducible: true,
        maxDataAgeSeconds: toNumberOption(parsed, 'max-data-age-seconds', 300)
      }
    });
    if (verify.verdict !== 'PASS') {
      const result = {
        step: stepName,
        mode,
        fundId,
        epochId,
        claimHash,
        observation: mine.observation,
        mine,
        verify
      };
      console.log(jsonStringify(result));
      const outFile = parsed.options.get('out-file');
      if (outFile) await writeJsonFile(outFile, result);
      const reportFile = parsed.options.get('report-file');
      if (reportFile) await writeJsonFile(reportFile, result);
      process.exitCode = 2;
      return;
    }
  }

  submit = await submitAllocation({
    fundId,
    epochId,
    observation: mine.observation,
    clientOptions: buildParticipantClientOptions(),
    submit: submitRequested
  });

  const result = {
    step: stepName,
    mode,
    fundId,
    epochId,
    claimHash: submit.claimHash ?? claimHash,
    observation: mine.observation,
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

  console.log(jsonStringify(result));
  const outFile = parsed.options.get('out-file');
  if (outFile) await writeJsonFile(outFile, result);
  const reportFile = parsed.options.get('report-file');
  if (reportFile) await writeJsonFile(reportFile, result);
  if (submit.status !== 'OK') {
    process.exitCode = 2;
  }
};

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const runParticipantDaemon = async (parsed: ParsedCli): Promise<void> => {
  const fundId = requiredOption(parsed, 'fund-id');
  const strategyRaw = requiredOption(parsed, 'strategy').trim().toUpperCase();
  const strategy = strategyRaw as ParticipantStrategyId;
  if (!['A', 'B', 'C'].includes(strategy)) {
    throw new Error('--strategy must be one of A,B,C');
  }

  const intervalSec = toNumberOption(parsed, 'interval-sec', 60);
  const submitRequested = parsed.flags.has('submit');
  const once = parsed.flags.has('once');
  const horizonSec = toNumberOption(parsed, 'horizon-sec', 3600);

  const epochSource = optionOrDefault(parsed, 'epoch-source', 'relayer')
    .trim()
    .toLowerCase();
  const fixedEpochIdRaw = parsed.options.get('epoch-id');

  const clientOptions = buildParticipantClientOptions();
  if (!clientOptions) {
    throw new Error(
      'participant daemon requires bot credentials: set PARTICIPANT_BOT_ID/PARTICIPANT_PRIVATE_KEY (or BOT_ID/PARTICIPANT_PRIVATE_KEY)'
    );
  }

  const relayerUrl = process.env.RELAYER_URL ?? '';
  if (!relayerUrl) throw new Error('RELAYER_URL is required');

  const relayer = createRelayerClient(clientOptions);
  const publicClient = createMonadTestnetPublicClient(process.env.RPC_URL);

  const resolveEpochId = async (): Promise<number> => {
    if (epochSource === 'fixed') {
      if (!fixedEpochIdRaw) throw new Error('--epoch-id is required when --epoch-source fixed');
      const fixed = Number(fixedEpochIdRaw);
      if (!Number.isFinite(fixed) || fixed <= 0) throw new Error('--epoch-id must be a positive number');
      return Math.trunc(fixed);
    }

    // relayer-based clock: use latest epochId + 1, or default to 1 if none.
    try {
      const latest = await relayer.getLatestEpoch(fundId);
      const epochState = (latest.epochState ?? latest.epoch_state ?? null) as any;
      const epochId = epochState?.epochId ?? epochState?.epoch_id ?? null;
      if (epochId === null || epochId === undefined) return 1;
      const next = Number(epochId) + 1;
      if (!Number.isFinite(next) || next <= 0) return 1;
      return Math.trunc(next);
    } catch {
      return 1;
    }
  };

  for (;;) {
    const epochId = await resolveEpochId();
    const targetWeights = await computeTargetWeights(strategy, { client: publicClient });

    const mine = await proposeAllocation({
      taskType: 'propose_allocation',
      fundId,
      roomId: optionOrDefault(parsed, 'room-id', 'participant-room'),
      epochId,
      allocation: {
        targetWeights,
        horizonSec
      }
    });

    if (mine.status !== 'OK' || !mine.observation) {
      console.log(jsonStringify({ step: 'propose_allocation', result: mine }));
    } else {
      const submit = await submitAllocation({
        fundId,
        epochId,
        observation: mine.observation,
        clientOptions,
        submit: submitRequested
      });
      console.log(
        jsonStringify({
          step: 'participant-daemon',
          strategy,
          fundId,
          epochId,
          decision: submit.decision ?? 'ERROR',
          claimHash: submit.claimHash ?? mine.observation.claimHash,
          weights: mine.observation.targetWeights,
          submit
        })
      );
    }

    if (once) return;
    await sleep(intervalSec * 1000);
  }
};

const printUsage = (): void => {
  console.log(`
[agents] participant commands

participant-allocation
  # mine (+ optional verify) (+ optional submit)
  --fund-id <id> --epoch-id <n> --target-weights <w1,w2,...>
  [--participant <0x...>] [--horizon-sec <n>] [--nonce <n>] [--room-id <id>]
  [--verify] [--max-data-age-seconds <n>] [--submit]
  [--out-file <path>] [--report-file <path>]

  # submit from file (optionally verify)
  --claim-file <path>
  [--room-id <id>] [--verify] [--max-data-age-seconds <n>] [--submit]
  [--out-file <path>] [--report-file <path>]

participant-daemon
  --fund-id <id> --strategy <A|B|C>
  [--epoch-source <relayer|fixed>] [--epoch-id <n>]
  [--interval-sec <n>] [--horizon-sec <n>] [--room-id <id>]
  [--submit] [--once]
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

  if (command === 'participant-allocation') {
    await runParticipantAllocation(parsed);
    return true;
  }
  if (command === 'participant-daemon') {
    await runParticipantDaemon(parsed);
    return true;
  }

  throw new Error(`unknown participant command: ${command}`);
};
