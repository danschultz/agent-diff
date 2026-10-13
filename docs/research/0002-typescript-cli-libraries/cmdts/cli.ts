import { binary, boolean, command, flag, oneOf, option, optional, positional, restPositionals, run, string, subcommands } from 'cmd-ts';
import { HOOK_EVENTS, hookClaude, review, start } from '../shared.ts';

const startCommand = command({
  name: 'start',
  description: 'Start a review session over one or more working directories.',
  args: {
    paths: restPositionals({ type: string, displayName: 'path', description: 'Working directories to review (default: the current directory)' }),
    base: option({ long: 'base', type: optional(string), description: 'Base ref to compare against' }),
    title: option({ long: 'title', type: optional(string), description: 'Title for the review session' }),
    open: flag({ long: 'open', type: boolean, description: 'Open the review UI in a browser' }),
  },
  handler: (args) => start(args),
});

const reviewCommand = command({
  name: 'review',
  description: 'Print the most recent review for the current working directory.',
  args: { json: flag({ long: 'json', type: boolean, description: 'Print JSON' }) },
  handler: (args) => review(args),
});

const hookClaudeCommand = command({
  name: 'claude',
  description: 'Handle a Claude Code hook event.',
  args: { event: positional({ type: oneOf(HOOK_EVENTS), displayName: 'event', description: 'Hook event' }) },
  handler: ({ event }) => hookClaude(event),
});

export const app = subcommands({
  name: 'agent-diff',
  description: 'Review changes made by coding agents.',
  cmds: {
    start: startCommand,
    review: reviewCommand,
    hook: subcommands({ name: 'hook', description: 'Handle harness hook events.', cmds: { claude: hookClaudeCommand } }),
  },
});

if (import.meta.main) await run(binary(app), process.argv);
