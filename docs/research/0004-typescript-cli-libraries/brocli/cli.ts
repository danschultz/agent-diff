import { boolean, command, positional, run, string } from '@drizzle-team/brocli';
import { HOOK_EVENTS, hookClaude, review, start } from '../shared.ts';

const startCommand = command({
  name: 'start',
  desc: 'Start a review session over one or more working directories.',
  options: {
    // Brocli has no variadic positionals, so this example takes at most one path.
    path: positional('path').desc('Working directory to review (default: the current directory)'),
    base: string().desc('Base ref to compare against'),
    title: string().desc('Title for the review session'),
    open: boolean().desc('Open the review UI in a browser').default(false),
  },
  handler: ({ path, ...opts }) => start({ paths: path === undefined ? [] : [path], ...opts }),
});

const reviewCommand = command({
  name: 'review',
  desc: 'Print the most recent review for the current working directory.',
  options: { json: boolean().desc('Print JSON').default(false) },
  handler: (opts) => review(opts),
});

const hookCommand = command({
  name: 'hook',
  desc: 'Handle harness hook events.',
  subcommands: [
    command({
      name: 'claude',
      desc: 'Handle a Claude Code hook event.',
      options: { event: positional('event').desc('Hook event').enum(...HOOK_EVENTS).required() },
      handler: ({ event }) => hookClaude(event),
    }),
  ],
});

export const commands = [startCommand, reviewCommand, hookCommand];

if (import.meta.main) await run(commands, { name: 'agent-diff', description: 'Review changes made by coding agents.' });
