#!/usr/bin/env node
import { runInitCommand } from './commands/init.js';
import {
  runOrderConfirmCommand,
  runOrderListCommand,
  runOrderPreviewCommand,
  runOrderResultCommand,
  runOrderStatusCommand,
} from './commands/order.js';
import { runSearchCommand } from './commands/search.js';
import type { Chain, SearchView } from './types.js';

export const HELP_TEXT = `croo — Agentic CLI client for CROO (Base CAP Escrow & BNB Chain B402)

Usage:
  croo init                                          Check Binance Agentic Wallet, address & balances
  croo search <query> [--view service|agent] [--chain base|bsc] [--limit N]
                                                     Search services (default) or agents across Base & BNB Chain
  croo search --agent <agent_id>                     List all orderable services of a specific agent
  croo order preview <id> [--requirements @file.json | '<json>'] [--method GET|POST]
                                                     Check required fields or generate a quote card (never charges)
  croo order confirm <draft_id>                      Pay for a previewed quote via Binance Agentic Wallet (x402)
  croo order status <order_id>                       Check CAP escrow timeline (Base) or settlement status (BNB)
  croo order result <order_id> [-o <file>]           Save deliverable to working directory
  croo order list                                    List local order history and refresh latest status

Global options:
  --json                                             Output machine-readable JSON
  -h, --help                                         Show help
  -v, --version                                      Show version`;

interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | boolean>;
}

const BOOLEAN_FLAGS = new Set(['json', 'help', 'h', 'version', 'v']);
const VALUE_FLAGS = new Set([
  'view',
  'chain',
  'agent',
  'limit',
  'requirements',
  'method',
  'o',
  'output',
  'q',
]);

export function parseArgv(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (token.startsWith('--')) {
      const eqIdx = token.indexOf('=');
      if (eqIdx > 0) {
        const key = token.slice(2, eqIdx);
        const val = token.slice(eqIdx + 1);
        if (BOOLEAN_FLAGS.has(key)) {
          flags[key] = val !== 'false' && val !== '0';
        } else if (VALUE_FLAGS.has(key)) {
          flags[key] = val;
        } else {
          throw new Error(`Unknown option "--${key}". Run \`croo --help\` for usage.`);
        }
      } else {
        const key = token.slice(2);
        if (BOOLEAN_FLAGS.has(key)) {
          flags[key] = true;
        } else if (VALUE_FLAGS.has(key)) {
          if (i + 1 >= argv.length) {
            throw new Error(`Option --${key} requires a value.`);
          }
          flags[key] = argv[++i];
        } else {
          throw new Error(`Unknown option "--${key}". Run \`croo --help\` for usage.`);
        }
      }
    } else if (token.startsWith('-') && token.length > 1) {
      const key = token.slice(1);
      if (BOOLEAN_FLAGS.has(key)) {
        flags[key] = true;
      } else if (VALUE_FLAGS.has(key)) {
        if (i + 1 >= argv.length) {
          throw new Error(`Option -${key} requires a value.`);
        }
        flags[key] = argv[++i];
      } else {
        throw new Error(`Unknown option "-${key}". Run \`croo --help\` for usage.`);
      }
    } else {
      positionals.push(token);
    }
  }

  return { positionals, flags };
}

export async function dispatchCli(argv: string[]): Promise<{ output: string; exitCode: number }> {
  const rawJsonFlag = argv.includes('--json');

  try {
    const { positionals, flags } = parseArgv(argv);
    const asJson = Boolean(flags.json);

    if (flags.version || flags.v) {
      return { output: '0.1.0', exitCode: 0 };
    }

    if (positionals.length === 0 || flags.help || flags.h) {
      return { output: HELP_TEXT, exitCode: 0 };
    }

    const command = positionals[0];

    if (command === 'init') {
      if (positionals.length > 1) {
        throw new Error('Unexpected argument for `croo init`. Usage: croo init [--json]');
      }
      const output = await runInitCommand({ json: asJson });
      return { output, exitCode: 0 };
    }

    if (command === 'search') {
      const query =
        positionals.slice(1).join(' ').trim() ||
        (typeof flags.q === 'string' ? flags.q : undefined);
      const viewFlag =
        typeof flags.view === 'string' ? (flags.view.toLowerCase() as SearchView) : undefined;
      if (viewFlag && viewFlag !== 'service' && viewFlag !== 'agent') {
        throw new Error(`Invalid --view "${flags.view}". Expected "service" or "agent".`);
      }

      const chainFlag =
        typeof flags.chain === 'string' ? (flags.chain.toLowerCase() as Chain) : undefined;
      if (chainFlag && chainFlag !== 'base' && chainFlag !== 'bsc') {
        throw new Error(`Invalid --chain "${flags.chain}". Expected "base" or "bsc".`);
      }

      const agentFlag = typeof flags.agent === 'string' ? flags.agent : undefined;
      let limitFlag: number | undefined;
      if (typeof flags.limit === 'string') {
        limitFlag = Number(flags.limit);
        if (!Number.isInteger(limitFlag) || limitFlag < 1 || limitFlag > 50) {
          throw new Error(`Invalid --limit "${flags.limit}". Expected an integer between 1 and 50.`);
        }
      }

      const output = await runSearchCommand({
        query,
        view: viewFlag,
        chain: chainFlag,
        agent: agentFlag,
        limit: limitFlag,
        json: asJson,
      });
      return { output, exitCode: 0 };
    }

    if (command === 'order') {
      const subcommand = positionals[1];
      if (!subcommand) {
        throw new Error(
          'Missing order subcommand. Expected one of: preview, confirm, status, result, list'
        );
      }

      if (subcommand === 'preview') {
        if (positionals.length > 3) {
          throw new Error(
            "Only one service can be previewed at a time. Usage: croo order preview <id> [--requirements @file.json | '<json>']"
          );
        }
        const id = positionals[2] || '';
        const reqFlag =
          typeof flags.requirements === 'string' ? flags.requirements : undefined;
        const methodRaw =
          typeof flags.method === 'string' ? flags.method.toUpperCase() : 'POST';
        if (methodRaw !== 'GET' && methodRaw !== 'POST') {
          throw new Error(`Invalid --method "${flags.method}". Expected "GET" or "POST".`);
        }
        const output = await runOrderPreviewCommand({
          id,
          requirements: reqFlag,
          method: methodRaw as 'GET' | 'POST',
          json: asJson,
        });
        return { output, exitCode: 0 };
      }

      if (subcommand === 'confirm') {
        if (positionals.length > 3) {
          throw new Error(
            'Only one order can be confirmed at a time. Usage: croo order confirm <draft_id>'
          );
        }
        const draftId = positionals[2] || '';
        const output = await runOrderConfirmCommand({
          draftId,
          json: asJson,
        });
        return { output, exitCode: 0 };
      }

      if (subcommand === 'status') {
        if (positionals.length > 3) {
          throw new Error('Usage: croo order status <order_id>');
        }
        const orderId = positionals[2] || '';
        const output = await runOrderStatusCommand({
          orderId,
          json: asJson,
        });
        return { output, exitCode: 0 };
      }

      if (subcommand === 'result') {
        if (positionals.length > 3) {
          throw new Error('Usage: croo order result <order_id> [-o <file>]');
        }
        const orderId = positionals[2] || '';
        const outFlag =
          typeof flags.o === 'string'
            ? flags.o
            : typeof flags.output === 'string'
              ? flags.output
              : undefined;
        const output = await runOrderResultCommand({
          orderId,
          output: outFlag,
          json: asJson,
        });
        return { output, exitCode: 0 };
      }

      if (subcommand === 'list') {
        if (positionals.length > 2) {
          throw new Error('Usage: croo order list [--json]');
        }
        const output = await runOrderListCommand({ json: asJson });
        return { output, exitCode: 0 };
      }

      throw new Error(
        `Unknown order subcommand "${subcommand}". Expected: preview, confirm, status, result, list`
      );
    }

    throw new Error(`Unknown command "${command}". Run \`croo --help\` for usage.`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (rawJsonFlag) {
      return {
        output: JSON.stringify({ error: true, message: msg }, null, 2),
        exitCode: 1,
      };
    }
    return {
      output: msg,
      exitCode: 1,
    };
  }
}

// Run when executed directly
const isDirectExecution =
  process.argv[1] &&
  (process.argv[1].endsWith('/cli.js') ||
    process.argv[1].endsWith('/cli.ts') ||
    process.argv[1].endsWith('/croo'));

if (isDirectExecution) {
  dispatchCli(process.argv.slice(2)).then(({ output, exitCode }) => {
    if (exitCode === 0) {
      console.log(output);
    } else {
      console.error(output);
    }
    process.exit(exitCode);
  });
}
