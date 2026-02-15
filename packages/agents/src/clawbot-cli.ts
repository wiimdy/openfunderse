import { runParticipantCli } from './participant-cli.js';
import { runStrategyCli } from './strategy-cli.js';
import { startDaemon } from './daemon.js';
import { resolveStrategySubmitGate } from './lib/strategy-safety.js';

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
    if (!token.startsWith('--')) continue;
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

const stripOption = (args: string[], key: string): string[] => {
  const result: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === `--${key}`) {
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        i += 1;
      }
      continue;
    }
    if (token.startsWith(`--${key}=`)) {
      continue;
    }
    result.push(token);
  }
  return result;
};

const mapCommand = (role: string, action: string): { command: string; extraArgs: string[] } => {
  if (role === 'strategy') {
    if (action === 'daemon') return { command: 'daemon', extraArgs: [] };
    if (action === 'create_fund_onchain') return { command: 'strategy-create-fund', extraArgs: [] };
    if (action === 'propose_intent') return { command: 'strategy-propose', extraArgs: [] };
    if (action === 'dry_run_intent_execution') return { command: 'strategy-dry-run-intent', extraArgs: [] };
    if (action === 'attest_intent_onchain') return { command: 'strategy-attest-onchain', extraArgs: [] };
    if (action === 'execute_intent_onchain') return { command: 'strategy-execute-ready', extraArgs: [] };
  }

  if (role === 'participant') {
    if (action === 'daemon') return { command: 'daemon', extraArgs: [] };

    // Unified action.
    if (action === 'allocation') return { command: 'participant-allocation', extraArgs: [] };

    // Backward-compatible actions (deprecated).
    if (action === 'propose_allocation') return { command: 'participant-allocation', extraArgs: [] };
    if (action === 'validate_allocation') return { command: 'participant-allocation', extraArgs: ['--verify'] };
    if (action === 'validate_allocation_or_intent') {
      return { command: 'participant-allocation', extraArgs: ['--verify'] };
    }
    if (action === 'submit_allocation') return { command: 'participant-allocation', extraArgs: ['--submit'] };
    if (action === 'allocation_e2e') return { command: 'participant-allocation', extraArgs: ['--verify'] };
  }

  throw new Error(`unsupported clawbot action: role=${role}, action=${action}`);
};

const printUsage = (): void => {
  console.log(`
[agents] clawbot-run

clawbot-run --role <strategy|participant> --action <action> [action options...]

Telegram slash aliases:
  /propose_intent, /dry_run_intent, /attest_intent, /execute_intent, /create_fund, /daemon
  /allocation, /participant_daemon

Examples:
  clawbot-run --role strategy --action propose_intent --fund-id demo-fund --intent-file ./intent.json --execution-route-file ./route.json
  clawbot-run --role participant --action allocation --fund-id demo-fund --epoch-id 1 --target-weights 7000,3000 --verify
  clawbot-run --role strategy --action daemon --fund-id demo-fund
  clawbot-run --role participant --action daemon --fund-id demo-fund
`);
};

export const runClawbotCli = async (argv: string[]): Promise<boolean> => {
  const parsed = parseCli(argv);
  const command = parsed.command ?? '';
  if (command !== 'clawbot-run' && command !== 'clawbot-help') {
    return false;
  }

  if (command === 'clawbot-help' || parsed.flags.has('help')) {
    printUsage();
    return true;
  }

  const role = (parsed.options.get('role') ?? '').trim().toLowerCase();
  const action = (parsed.options.get('action') ?? '').trim().toLowerCase();
  if (!role) throw new Error('missing required option --role');
  if (!action) throw new Error('missing required option --action');

  const mapped = mapCommand(role, action);
  const forwarded = stripOption(stripOption(argv.slice(1), 'role'), 'action');
  const delegatedArgv = [mapped.command, ...mapped.extraArgs, ...forwarded];

  if (mapped.command === 'strategy-propose') {
    resolveStrategySubmitGate(parsed.flags.has('submit'));
  }

  if (mapped.command === 'daemon') {
    const fundId = parsed.options.get('fund-id') ?? '';
    if (!fundId) throw new Error('missing required option --fund-id for daemon mode');

    const relayerUrl = process.env.RELAYER_URL ?? '';
    const botId = process.env.BOT_ID ?? '';
    const privateKey =
      process.env.STRATEGY_PRIVATE_KEY ?? process.env.PARTICIPANT_PRIVATE_KEY ?? '';

    console.log(`[daemon] starting ${role} daemon for fund ${fundId}`);
    const instance = startDaemon({
      role: role as 'strategy' | 'participant',
      fundId,
      relayerUrl,
      botId,
      privateKey
    });

    process.on('SIGINT', () => {
      console.log('[daemon] shutting down...');
      instance.stop();
      process.exit(0);
    });

    await new Promise<void>(() => undefined);
    return true;
  }

  if (mapped.command.startsWith('strategy-')) {
    await runStrategyCli(delegatedArgv);
    return true;
  }

  await runParticipantCli(delegatedArgv);
  return true;
};
