import { cli, define } from 'gunshi';
import { HOOK_EVENTS, hookClaude, review, start, type HookEvent } from '../shared.ts';

const startCommand = define({
  name: 'start',
  description: 'Start a review session over one or more working directories.',
  args: {
    path: { type: 'positional', multiple: true, description: 'Working directories to review (default: the current directory)' },
    base: { type: 'string', description: 'Base ref to compare against' },
    title: { type: 'string', description: 'Title for the review session' },
    open: { type: 'boolean', default: false, description: 'Open the review UI in a browser' },
  },
  run: ({ values }) => start({ paths: values.path ?? [], base: values.base, title: values.title, open: values.open }),
});

const reviewCommand = define({
  name: 'review',
  description: 'Print the most recent review for the current working directory.',
  args: { json: { type: 'boolean', default: false, description: 'Print JSON' } },
  run: ({ values }) => review({ json: values.json }),
});

const hookClaudeCommand = define({
  name: 'claude',
  description: 'Handle a Claude Code hook event.',
  args: { event: { type: 'positional', description: `Hook event (${HOOK_EVENTS.join(', ')})` } },
  run: ({ values }) => {
    // enum is only for named options, so the positional is checked by hand.
    if (!HOOK_EVENTS.includes(values.event as HookEvent)) {
      throw new Error(`Invalid event "${values.event}". Expected one of: ${HOOK_EVENTS.join(', ')}`);
    }
    hookClaude(values.event as HookEvent);
  },
});

const hookCommand = define({
  name: 'hook',
  description: 'Handle harness hook events.',
  subCommands: { claude: hookClaudeCommand },
});

// gunshi always has an entry command; this one runs when no subcommand is given.
export const main = define({ run: () => { throw new Error('Missing command. Run `agent-diff --help`.'); } });

export function run(argv: string[]) {
  return cli(argv, main, {
    name: 'agent-diff',
    description: 'Review changes made by coding agents.',
    strict: true, // reject unknown options
    renderHeader: null, // otherwise a header line is printed before every command's output
    subCommands: { start: startCommand, review: reviewCommand, hook: hookCommand },
  });
}

if (import.meta.main) {
  // gunshi prints usage errors, then rejects; the rejection would otherwise print a stack trace.
  await run(process.argv.slice(2)).catch((error: Error) => {
    if (!(error instanceof AggregateError)) console.error(error.message);
    process.exit(1);
  });
}
