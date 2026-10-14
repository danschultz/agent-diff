import { cli } from 'cli-forge';
import { HOOK_EVENTS, hookClaude, review, start } from '../shared.ts';

export const app = cli('agent-diff', {
  description: 'Review changes made by coding agents.',
  builder: (app) =>
    app
      .strict() // reject unknown options
      .command('start', {
        description: 'Start a review session over one or more working directories.',
        builder: (a) =>
          a
            .positional('path', {
              type: 'array',
              items: 'string',
              default: [],
              description: 'Working directories to review (default: the current directory)',
            })
            .option('base', { type: 'string', description: 'Base ref to compare against' })
            .option('title', { type: 'string', description: 'Title for the review session' })
            .option('open', { type: 'boolean', default: false, description: 'Open the review UI in a browser' }),
        handler: (args) => start({ paths: args.path, base: args.base, title: args.title, open: args.open }),
      })
      .command('review', {
        description: 'Print the most recent review for the current working directory.',
        builder: (a) => a.option('json', { type: 'boolean', default: false, description: 'Print JSON' }),
        handler: (args) => review({ json: args.json }),
      })
      .command('hook', {
        description: 'Handle harness hook events.',
        builder: (a) =>
          a.command('claude', {
            description: 'Handle a Claude Code hook event.',
            builder: (a) =>
              a.positional('event', { type: 'string', choices: HOOK_EVENTS, required: true, description: 'Hook event' }),
            handler: (args) => hookClaude(args.event),
          }),
      }),
});

if (import.meta.main) await app.forge();
