import { defineCommand, runMain } from 'citty';
import { HOOK_EVENTS, hookClaude, review, start, type HookEvent } from '../shared.ts';

const startCommand = defineCommand({
  meta: { name: 'start', description: 'Start a review session over one or more working directories.' },
  args: {
    path: { type: 'positional', required: false, description: 'Working directories to review (default: the current directory)' },
    base: { type: 'string', description: 'Base ref to compare against' },
    title: { type: 'string', description: 'Title for the review session' },
    open: { type: 'boolean', default: false, description: 'Open the review UI in a browser' },
  },
  run({ args }) {
    // citty has no variadic positionals; extra positionals are in args._.
    start({ paths: args._, base: args.base, title: args.title, open: args.open });
  },
});

const reviewCommand = defineCommand({
  meta: { name: 'review', description: 'Print the most recent review for the current working directory.' },
  args: { json: { type: 'boolean', default: false, description: 'Print JSON' } },
  run({ args }) {
    review({ json: args.json });
  },
});

const hookClaudeCommand = defineCommand({
  meta: { name: 'claude', description: 'Handle a Claude Code hook event.' },
  args: { event: { type: 'positional', required: true, description: `Hook event (${HOOK_EVENTS.join(', ')})` } },
  run({ args }) {
    // enum is only for named options, so the positional is checked by hand.
    if (!HOOK_EVENTS.includes(args.event as HookEvent)) {
      throw new Error(`Invalid event "${args.event}". Expected one of: ${HOOK_EVENTS.join(', ')}`);
    }
    hookClaude(args.event as HookEvent);
  },
});

export const main = defineCommand({
  meta: { name: 'agent-diff', description: 'Review changes made by coding agents.' },
  subCommands: {
    start: startCommand,
    review: reviewCommand,
    hook: defineCommand({ meta: { name: 'hook', description: 'Handle harness hook events.' }, subCommands: { claude: hookClaudeCommand } }),
  },
});

if (import.meta.main) await runMain(main);
