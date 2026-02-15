import { runParticipantCli } from './participant-cli.js';
import { runStrategyCli } from './strategy-cli.js';
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

const mapCommand = (role: string, action: string): string => {
  if (role === 'strategy') {
    if (action === 'create_fund_onchain') return 'strategy-create-fund';
    if (action === 'propose_intent') return 'strategy-propose';
    if (action === 'dry_run_intent_execution') return 'strategy-dry-run-intent';
    if (action === 'attest_intent_onchain') return 'strategy-attest-onchain';
    if (action === 'execute_intent_onchain') return 'strategy-execute-ready';
  }

  if (role === 'participant') {
    if (action === 'propose_allocation') return 'participant-propose-allocation';
    if (action === 'validate_allocation') return 'participant-validate-allocation';
    if (action === 'validate_allocation_or_intent') return 'participant-validate-allocation';
    if (action === 'submit_allocation') return 'participant-submit-allocation';
    if (action === 'allocation_e2e') return 'participant-allocation-e2e';
  }

  throw new Error(`unsupported clawbot action: role=${role}, action=${action}`);
};

const printUsage = (): void => {
  console.log(`
[agents] clawbot-run

clawbot-run --role <strategy|participant> --action <action> [action options...]

Telegram slash aliases:
  /propose_intent, /dry_run_intent, /attest_intent, /execute_intent, /create_fund
  /propose_allocation, /validate_allocation, /submit_allocation, /allocation_e2e

Examples:
  clawbot-run --role strategy --action propose_intent --fund-id demo-fund --intent-file ./intent.json --execution-route-file ./route.json
  clawbot-run --role participant --action propose_allocation --fund-id demo-fund --epoch-id 1 --target-weights 7000,3000
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
  const delegatedArgv = [mapped, ...forwarded];

  if (mapped === 'strategy-propose') {
    resolveStrategySubmitGate(parsed.flags.has('submit'));
  }

  if (mapped.startsWith('strategy-')) {
    await runStrategyCli(delegatedArgv);
    return true;
  }

  await runParticipantCli(delegatedArgv);
  return true;
};
