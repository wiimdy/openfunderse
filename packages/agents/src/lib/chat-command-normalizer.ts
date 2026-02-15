const COMMAND_ALIAS: Record<string, string[]> = {
  help: ['clawbot-help'],
  start: ['clawbot-help'],
  clawbot: ['clawbot-help'],
  'clawbot-help': ['clawbot-help'],
  run: ['clawbot-run'],
  'clawbot-run': ['clawbot-run'],

  'propose-intent': ['clawbot-run', '--role', 'strategy', '--action', 'propose_intent'],
  'dry-run-intent': [
    'clawbot-run',
    '--role',
    'strategy',
    '--action',
    'dry_run_intent_execution'
  ],
  'dry-run-intent-execution': [
    'clawbot-run',
    '--role',
    'strategy',
    '--action',
    'dry_run_intent_execution'
  ],
  'attest-intent': ['clawbot-run', '--role', 'strategy', '--action', 'attest_intent_onchain'],
  'attest-intent-onchain': [
    'clawbot-run',
    '--role',
    'strategy',
    '--action',
    'attest_intent_onchain'
  ],
  'execute-intent': ['clawbot-run', '--role', 'strategy', '--action', 'execute_intent_onchain'],
  'execute-intent-onchain': [
    'clawbot-run',
    '--role',
    'strategy',
    '--action',
    'execute_intent_onchain'
  ],
  'create-fund': ['clawbot-run', '--role', 'strategy', '--action', 'create_fund_onchain'],
  'create-fund-onchain': ['clawbot-run', '--role', 'strategy', '--action', 'create_fund_onchain'],

  // Participant: unified allocation flow.
  allocation: ['clawbot-run', '--role', 'participant', '--action', 'allocation'],
  join: ['clawbot-run', '--role', 'participant', '--action', 'join']
};

const normalizeCommandToken = (token: string): string => {
  const trimmed = token.trim();
  const withoutSlash = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
  const botMentionOffset = withoutSlash.indexOf('@');
  const withoutMention =
    botMentionOffset >= 0 ? withoutSlash.slice(0, botMentionOffset) : withoutSlash;
  return withoutMention.replace(/_/g, '-').toLowerCase();
};

const normalizeOptionToken = (token: string): string[] => {
  const match = token.match(/^([A-Za-z][A-Za-z0-9_-]*)=(.+)$/);
  if (!match) {
    return [token];
  }
  const key = match[1].replace(/_/g, '-').toLowerCase();
  const value = match[2].trim();
  const normalizedValue = value.toLowerCase();

  // Allow flag-style options via key=value in chat contexts.
  if (['true', '1', 'yes', 'on'].includes(normalizedValue)) {
    return [`--${key}`];
  }
  if (['false', '0', 'no', 'off'].includes(normalizedValue)) {
    // Allow overriding default-on flags (ex: submit=false, verify=false) in chat contexts.
    return [`--no-${key}`];
  }

  return [`--${key}`, value];
};

export const normalizeChatCommandArgv = (argv: string[]): string[] => {
  const first = argv[0];
  if (!first || !first.startsWith('/')) {
    return argv;
  }

  const normalized = normalizeCommandToken(first);
  if (!normalized) {
    return argv;
  }

  const mappedHead = COMMAND_ALIAS[normalized] ?? [normalized];
  const tail = argv.slice(1).flatMap(normalizeOptionToken);
  return [...mappedHead, ...tail];
};
