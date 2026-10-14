import { Crust, defineCommand } from '@crustjs/core';
import { didYouMean, help } from '@crustjs/extensions';
import { HOOK_EVENTS, hookClaude, review, start } from '../shared.ts';

const startCommand = defineCommand(
  'start',
  { description: 'Start a review session over one or more working directories.' },
  (c) =>
    c
      .args({ name: 'path', type: 'string', variadic: true, description: 'Working directories to review (default: the current directory)' })
      .flags(
        { name: 'base', type: 'string', description: 'Base ref to compare against' },
        { name: 'title', type: 'string', description: 'Title for the review session' },
        { name: 'open', type: 'boolean', default: false, description: 'Open the review UI in a browser' },
      )
      .action(({ args, flags }) => start({ paths: args.path, ...flags })),
);

const reviewCommand = defineCommand(
  'review',
  { description: 'Print the most recent review for the current working directory.' },
  (c) =>
    c
      .flags({ name: 'json', type: 'boolean', default: false, description: 'Print JSON' })
      .action(({ flags }) => review(flags)),
);

const hookClaudeCommand = defineCommand('claude', { description: 'Handle a Claude Code hook event.' }, (c) =>
  c
    .args({ name: 'event', type: 'string', choices: HOOK_EVENTS, required: true, description: 'Hook event' })
    .action(({ args }) => hookClaude(args.event)),
);

const hookCommand = defineCommand('hook', { description: 'Handle harness hook events.' }, (c) => c.add(hookClaudeCommand));

export const app = new Crust('agent-diff', { description: 'Review changes made by coding agents.' })
  .extend(help(), didYouMean())
  .add(startCommand, reviewCommand, hookCommand);

if (import.meta.main) await app.execute();
