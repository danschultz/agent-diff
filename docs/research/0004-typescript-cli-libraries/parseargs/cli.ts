import { parseArgs } from 'node:util';
import { HOOK_EVENTS, hookClaude, review, start, type HookEvent } from '../shared.ts';

const USAGE = `Usage: agent-diff <command> [options]

Review changes made by coding agents.

Commands:
  start [<path>...] [--base <ref>] [--title <text>] [--open]
      Start a review session over one or more working directories.
      <path>          Working directories to review (default: the current directory)
      --base <ref>    Base ref to compare against
      --title <text>  Title for the review session
      --open          Open the review UI in a browser
  review [--json]
      Print the most recent review for the current working directory.
      --json          Print JSON
  hook claude <SessionStart|UserPromptSubmit|Stop>
      Handle a Claude Code hook event.
`;

export function main(argv: string[]): void {
  const [command, ...args] = argv;
  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(USAGE);
    return;
  }
  const help = args.includes('--help') || args.includes('-h');
  switch (command) {
    case 'start': {
      if (help) return void process.stdout.write(USAGE);
      const { values, positionals } = parseArgs({
        args,
        allowPositionals: true,
        options: { base: { type: 'string' }, title: { type: 'string' }, open: { type: 'boolean', default: false } },
      });
      return start({ paths: positionals, base: values.base, title: values.title, open: values.open });
    }
    case 'review': {
      if (help) return void process.stdout.write(USAGE);
      const { values } = parseArgs({ args, options: { json: { type: 'boolean', default: false } } });
      return review({ json: values.json });
    }
    case 'hook': {
      if (help) return void process.stdout.write(USAGE);
      const { positionals } = parseArgs({ args, allowPositionals: true });
      const [agent, event] = positionals;
      if (agent !== 'claude') throw new Error(`Unknown agent "${agent ?? ''}". Expected: claude`);
      if (!HOOK_EVENTS.includes(event as HookEvent)) {
        throw new Error(`Unknown hook event "${event ?? ''}". Expected one of: ${HOOK_EVENTS.join(', ')}`);
      }
      return hookClaude(event as HookEvent);
    }
    default:
      throw new Error(`Unknown command "${command}". Run \`agent-diff --help\`.`);
  }
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(`agent-diff: ${(error as Error).message}`);
  process.exit(2);
}
