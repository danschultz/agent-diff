import { Cli, z } from 'incur';
import { HOOK_EVENTS, hookClaude, review, start } from '../shared.ts';

const hook = Cli.create('hook', { description: 'Handle harness hook events.' }).command('claude', {
  description: 'Handle a Claude Code hook event.',
  args: z.object({ event: z.enum(HOOK_EVENTS).describe('Hook event') }),
  run: (c) => hookClaude(c.args.event),
});

export const cli = Cli.create('agent-diff', { description: 'Review changes made by coding agents.', version: '0.0.0' })
  .command('start', {
    description: 'Start a review session over one or more working directories.',
    args: z.object({
      paths: z.array(z.string()).default([]).describe('Working directories to review (default: the current directory)'),
    }),
    options: z.object({
      base: z.string().optional().describe('Base ref to compare against'),
      title: z.string().optional().describe('Title for the review session'),
      open: z.boolean().default(false).describe('Open the review UI in a browser'),
    }),
    run: (c) => start({ paths: c.args.paths, ...c.options }),
  })
  .command('review', {
    description: 'Print the most recent review for the current working directory.',
    // --json is a built-in global option, so review doesn't declare it.
    run: (c) => review({ json: c.format === 'json' }),
  })
  .command(hook);

if (import.meta.main) await cli.serve();
