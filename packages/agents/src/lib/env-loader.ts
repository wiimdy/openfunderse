import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type EnvProfile = 'strategy' | 'participant' | 'all';

const STRATEGY_COMMAND_PREFIX = 'strategy-';
const PARTICIPANT_COMMAND_PREFIX = 'participant-';

const parseOptionValue = (argv: string[], key: string): string | undefined => {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === `--${key}`) {
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) {
        return '';
      }
      return next;
    }
    if (token.startsWith(`--${key}=`)) {
      return token.slice(`--${key}=`.length);
    }
  }
  return undefined;
};

const inferProfile = (argv: string[]): EnvProfile => {
  const command = (argv[0] ?? '').trim().toLowerCase();
  if (command.startsWith(STRATEGY_COMMAND_PREFIX)) {
    return 'strategy';
  }
  if (command.startsWith(PARTICIPANT_COMMAND_PREFIX)) {
    return 'participant';
  }
  if (command === 'clawbot-run') {
    const role = (parseOptionValue(argv, 'role') ?? '').trim().toLowerCase();
    if (role === 'strategy') {
      return 'strategy';
    }
    if (role === 'participant') {
      return 'participant';
    }
  }
  return 'all';
};

const parseValue = (rawValue: string): string => {
  const value = rawValue.trim();
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    return value.slice(1, -1);
  }
  return value;
};

const parseEnvContent = (content: string): Map<string, string> => {
  const parsed = new Map<string, string>();
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) {
      continue;
    }
    const key = match[1];
    const value = parseValue(match[2] ?? '');
    parsed.set(key, value);
  }

  return parsed;
};

const candidateFilesForProfile = (profile: EnvProfile): string[] => {
  if (profile === 'strategy') {
    return ['.env', '.env.strategy'];
  }
  if (profile === 'participant') {
    return ['.env', '.env.participant'];
  }
  return ['.env'];
};

const resolveOpenclawConfigPath = (): string => {
  const explicitPath = (
    process.env.OPENCLAW_CONFIG_PATH ??
    process.env.OPENCLAW_CONFIG_FILE
  )?.trim();
  if (explicitPath) {
    return path.resolve(explicitPath);
  }

  return path.join(os.homedir(), '.openclaw', 'openclaw.json');
};

const parseOpenclawEnvVars = (
  configPath: string
): Map<string, string> => {
  const entries = new Map<string, string>();
  if (!existsSync(configPath)) {
    return entries;
  }

  try {
    const raw = readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as {
      env?: {
        vars?: Record<string, unknown>;
      };
    };
    const vars = parsed?.env?.vars;
    if (!vars || typeof vars !== 'object' || Array.isArray(vars)) {
      return entries;
    }

    for (const [key, rawValue] of Object.entries(vars)) {
      if (!key || typeof key !== 'string') {
        continue;
      }
      if (rawValue === null || rawValue === undefined) {
        continue;
      }
      if (typeof rawValue === 'object') {
        continue;
      }
      entries.set(key, String(rawValue));
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[agents] warning: failed to read OpenClaw env config (${configPath}): ${message}`
    );
  }

  return entries;
};

export const loadDefaultEnvForArgv = (argv: string[]): void => {
  const profile = inferProfile(argv);
  const cwd = process.cwd();
  const preservedKeys = new Set(Object.keys(process.env));
  const openclawConfigPath = resolveOpenclawConfigPath();
  const openclawEntries = parseOpenclawEnvVars(openclawConfigPath);

  // OpenClaw config should win over local .env files.
  for (const [key, value] of openclawEntries) {
    if (preservedKeys.has(key)) {
      continue;
    }
    process.env[key] = value;
    preservedKeys.add(key);
  }

  for (const fileName of candidateFilesForProfile(profile)) {
    const filePath = path.join(cwd, fileName);
    if (!existsSync(filePath)) {
      continue;
    }

    const entries = parseEnvContent(readFileSync(filePath, 'utf8'));
    for (const [key, value] of entries) {
      if (preservedKeys.has(key)) {
        continue;
      }
      process.env[key] = value;
    }
  }
};
