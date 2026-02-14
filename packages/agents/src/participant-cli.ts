import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { isAddress, type Hex } from 'viem';
import type { RelayerClientOptions } from './lib/relayer-client.js';
import type { BotSignerOptions } from './lib/signer.js';
import {
  attestClaim,
  mineClaim,
  submitMinedClaim,
  verifyClaim,
  type MineClaimOutput,
  type MineClaimObservation
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
  const botApiKey = process.env[`${prefix}_BOT_API_KEY`];
  const botAddress = process.env[`${prefix}_BOT_ADDRESS`];

  if (!botId && !botApiKey && !botAddress) {
    return undefined;
  }
  if (!botId || !botApiKey) {
    throw new Error(
      `${prefix}_BOT_ID and ${prefix}_BOT_API_KEY must be set together`
    );
  }
  if (botAddress && !isAddress(botAddress)) {
    throw new Error(`${prefix}_BOT_ADDRESS must be a valid address`);
  }

  return {
    botId,
    botApiKey,
    botAddress: botAddress as `0x${string}` | undefined
  };
};

const buildDefaultBotClientOptions = (): RelayerClientOptions | undefined => {
  const botId = process.env.BOT_ID;
  const botApiKey = process.env.BOT_API_KEY;
  const botAddress = process.env.BOT_ADDRESS;

  if (!botId && !botApiKey && !botAddress) {
    return undefined;
  }
  if (!botId || !botApiKey) {
    throw new Error('BOT_ID and BOT_API_KEY must be set together');
  }
  if (botAddress && !isAddress(botAddress)) {
    throw new Error('BOT_ADDRESS must be a valid address');
  }

  return {
    botId,
    botApiKey,
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

const participantCrawlerAddress = (): `0x${string}` | undefined => {
  const raw = process.env.PARTICIPANT_BOT_ADDRESS ?? process.env.BOT_ADDRESS;

  if (!raw || raw.trim().length === 0) {
    return undefined;
  }
  if (!isAddress(raw)) {
    throw new Error(
      'PARTICIPANT_BOT_ADDRESS (or BOT_ADDRESS fallback) must be a valid address'
    );
  }
  return raw as `0x${string}`;
};

const buildVerifierSignerOptions = (): BotSignerOptions => {
  const options: BotSignerOptions = {};
  if (process.env.PARTICIPANT_PRIVATE_KEY) {
    options.privateKey = process.env.PARTICIPANT_PRIVATE_KEY as Hex;
  } else if (process.env.VERIFIER_PRIVATE_KEY) {
    options.privateKey = process.env.VERIFIER_PRIVATE_KEY as Hex;
  }
  if (process.env.CLAIM_ATTESTATION_VERIFIER_ADDRESS && isAddress(process.env.CLAIM_ATTESTATION_VERIFIER_ADDRESS)) {
    options.claimAttestationVerifierAddress =
      process.env.CLAIM_ATTESTATION_VERIFIER_ADDRESS as `0x${string}`;
  }
  if (process.env.CHAIN_ID) {
    options.chainId = BigInt(process.env.CHAIN_ID);
  }
  return options;
};

const observationToClaimPayload = (
  observation: MineClaimObservation
): Record<string, unknown> => {
  return {
    sourceRef: observation.canonicalPayload.sourceRef,
    extracted: observation.canonicalPayload.extracted,
    responseHash: observation.canonicalPayload.responseHash,
    evidenceURI: observation.canonicalPayload.evidenceURI,
    timestamp: Number(observation.canonicalPayload.timestamp)
  };
};

const readObservationFromFile = async (
  claimFile: string
): Promise<{ fundId: string; epochId: number; observation: MineClaimObservation }> => {
  const parsed = await readJsonFile<Record<string, unknown>>(claimFile);
  if (parsed.observation) {
    const observation = parsed.observation as MineClaimObservation;
    const fundId = String(parsed.fundId ?? '');
    const epochId = Number(parsed.epochId ?? 0);
    if (!fundId || !Number.isFinite(epochId)) {
      throw new Error('claim file is missing fundId/epochId');
    }
    return { fundId, epochId: Math.trunc(epochId), observation };
  }
  if (parsed.claimHash && parsed.canonicalPayload) {
    const observation = parsed as unknown as MineClaimObservation;
    const fundId = String(parsed.fundId ?? '');
    const epochId = Number(parsed.epochId ?? 0);
    if (!fundId || !Number.isFinite(epochId)) {
      throw new Error('observation file is missing fundId/epochId');
    }
    return { fundId, epochId: Math.trunc(epochId), observation };
  }
  throw new Error('unsupported claim file format');
};

const runParticipantMine = async (parsed: ParsedCli): Promise<void> => {
  const fundId = requiredOption(parsed, 'fund-id');
  const epochId = Number(requiredOption(parsed, 'epoch-id'));
  if (!Number.isFinite(epochId)) {
    throw new Error('--epoch-id must be a number');
  }

  const sourceRef = requiredOption(parsed, 'source-ref');
  const tokenAddress = requiredOption(parsed, 'token-address');
  const output = await mineClaim({
    taskType: 'mine_claim',
    fundId,
    roomId: optionOrDefault(parsed, 'room-id', 'participant-room'),
    epochId: Math.trunc(epochId),
    sourceSpec: {
      sourceSpecId: optionOrDefault(parsed, 'source-spec-id', 'participant-source'),
      sourceRef,
      extractor: { mode: 'raw-slice-256' },
      freshnessSeconds: toNumberOption(parsed, 'freshness-seconds', 15)
    },
    tokenContext: {
      symbol: optionOrDefault(parsed, 'token-symbol', 'TOKEN'),
      address: tokenAddress
    },
    crawlerAddress: participantCrawlerAddress()
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

const runParticipantVerify = async (parsed: ParsedCli): Promise<void> => {
  const claimFile = requiredOption(parsed, 'claim-file');
  const bundle = await readObservationFromFile(claimFile);
  const output = await verifyClaim({
    taskType: 'verify_claim_or_intent_validity',
    fundId: bundle.fundId,
    roomId: optionOrDefault(parsed, 'room-id', 'participant-room'),
    epochId: bundle.epochId,
    subjectType: 'CLAIM',
    subjectHash: bundle.observation.claimHash,
    subjectPayload: observationToClaimPayload(bundle.observation),
    validationPolicy: {
      reproducible: optionOrDefault(parsed, 'reproducible', 'true') !== 'false',
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

const runParticipantSubmit = async (parsed: ParsedCli): Promise<void> => {
  const claimFile = requiredOption(parsed, 'claim-file');
  const bundle = await readObservationFromFile(claimFile);
  const output = await submitMinedClaim({
    fundId: bundle.fundId,
    epochId: bundle.epochId,
    observation: bundle.observation,
    clientOptions: buildParticipantClientOptions()
  });
  console.log(jsonStringify(output));
  if (output.status !== 'OK') {
    process.exitCode = 2;
  }
};

const runParticipantAttest = async (parsed: ParsedCli): Promise<void> => {
  const fundId = requiredOption(parsed, 'fund-id');
  const epochId = Number(requiredOption(parsed, 'epoch-id'));
  if (!Number.isFinite(epochId)) {
    throw new Error('--epoch-id must be a number');
  }
  const claimHash = requiredOption(parsed, 'claim-hash');
  const output = await attestClaim({
    fundId,
    claimHash: claimHash as `0x${string}`,
    epochId: Math.trunc(epochId),
    expiresInSeconds: toNumberOption(parsed, 'expires-in-seconds', 900),
    clientOptions: buildParticipantClientOptions(),
    signerOptions: buildVerifierSignerOptions()
  });
  console.log(jsonStringify(output));
  if (output.status !== 'OK') {
    process.exitCode = 2;
  }
};

const runParticipantE2E = async (parsed: ParsedCli): Promise<void> => {
  const fundId = requiredOption(parsed, 'fund-id');
  const epochId = Number(requiredOption(parsed, 'epoch-id'));
  if (!Number.isFinite(epochId)) {
    throw new Error('--epoch-id must be a number');
  }

  const mine = await mineClaim({
    taskType: 'mine_claim',
    fundId,
    roomId: optionOrDefault(parsed, 'room-id', 'participant-room'),
    epochId: Math.trunc(epochId),
    sourceSpec: {
      sourceSpecId: optionOrDefault(parsed, 'source-spec-id', 'participant-source'),
      sourceRef: requiredOption(parsed, 'source-ref'),
      extractor: { mode: 'raw-slice-256' },
      freshnessSeconds: toNumberOption(parsed, 'freshness-seconds', 15)
    },
    tokenContext: {
      symbol: optionOrDefault(parsed, 'token-symbol', 'TOKEN'),
      address: requiredOption(parsed, 'token-address')
    },
    crawlerAddress: participantCrawlerAddress()
  });
  if (mine.status !== 'OK' || !mine.observation) {
    console.log(jsonStringify({ step: 'mine', result: mine }));
    process.exitCode = 2;
    return;
  }

  const verify = await verifyClaim({
    taskType: 'verify_claim_or_intent_validity',
    fundId,
    roomId: optionOrDefault(parsed, 'room-id', 'participant-room'),
    epochId: Math.trunc(epochId),
    subjectType: 'CLAIM',
    subjectHash: mine.observation.claimHash,
    subjectPayload: observationToClaimPayload(mine.observation),
    validationPolicy: {
      reproducible: optionOrDefault(parsed, 'reproducible', 'true') !== 'false',
      maxDataAgeSeconds: toNumberOption(parsed, 'max-data-age-seconds', 300)
    }
  });
  if (verify.verdict !== 'PASS') {
    console.log(jsonStringify({ step: 'verify', result: verify }));
    process.exitCode = 2;
    return;
  }

  const submit = await submitMinedClaim({
    fundId,
    epochId: Math.trunc(epochId),
    observation: mine.observation,
    clientOptions: buildParticipantClientOptions()
  });
  if (submit.status !== 'OK' || !submit.claimHash) {
    console.log(jsonStringify({ step: 'submit', result: submit }));
    process.exitCode = 2;
    return;
  }

  const attest = await attestClaim({
    fundId,
    claimHash: submit.claimHash as `0x${string}`,
    epochId: Math.trunc(epochId),
    expiresInSeconds: toNumberOption(parsed, 'expires-in-seconds', 900),
    clientOptions: buildParticipantClientOptions(),
    signerOptions: buildVerifierSignerOptions()
  });

  const report = {
    step: 'participant-e2e',
    fundId,
    epochId: Math.trunc(epochId),
    claimHash: submit.claimHash,
    mine,
    verify,
    submit,
    attest
  };
  console.log(jsonStringify(report));

  const reportFile = parsed.options.get('report-file');
  if (reportFile) {
    await writeJsonFile(reportFile, report);
  }

  if (attest.status !== 'OK') {
    process.exitCode = 2;
  }
};

const printUsage = (): void => {
  console.log(`
[agents] participant commands

participant-mine
  --fund-id <id> --epoch-id <n> --source-ref <url> --token-address <0x...>
  [--source-spec-id <id>] [--token-symbol <sym>] [--room-id <id>]
  [--freshness-seconds <n>] [--out-file <path>]

participant-verify
  --claim-file <path>
  [--reproducible true|false] [--max-data-age-seconds <n>] [--out-file <path>]

participant-submit
  --claim-file <path>

participant-attest
  --fund-id <id> --epoch-id <n> --claim-hash <0x...>
  [--expires-in-seconds <n>]

participant-e2e
  --fund-id <id> --epoch-id <n> --source-ref <url> --token-address <0x...>
  [--token-symbol <sym>] [--reproducible true|false] [--report-file <path>]
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

  if (command === 'participant-mine') {
    await runParticipantMine(parsed);
    return true;
  }
  if (command === 'participant-verify') {
    await runParticipantVerify(parsed);
    return true;
  }
  if (command === 'participant-submit') {
    await runParticipantSubmit(parsed);
    return true;
  }
  if (command === 'participant-attest') {
    await runParticipantAttest(parsed);
    return true;
  }
  if (command === 'participant-e2e') {
    await runParticipantE2E(parsed);
    return true;
  }

  throw new Error(`unknown participant command: ${command}`);
};
