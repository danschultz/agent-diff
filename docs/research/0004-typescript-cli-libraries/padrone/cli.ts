import { createPadrone } from 'padrone';
import * as z from 'zod/v4';
import { HOOK_EVENTS, hookClaude, review, start } from '../shared.ts';

export const program = createPadrone('agent-diff')
  .configure({ description: 'Review changes made by coding agents.' })
  .command('start', (c) =>
    c
      .describe('Start a review session over one or more working directories.')
      .arguments(
        z.object({
          paths: z.array(z.string()).default([]).describe('Working directories to review (default: the current directory)'),
          base: z.string().optional().describe('Base ref to compare against'),
          title: z.string().optional().describe('Title for the review session'),
          open: z.boolean().default(false).describe('Open the review UI in a browser'),
        }),
        { positional: ['...paths'] },
      )
      .action((args) => start(args)),
  )
  .command('review', (c) =>
    c
      .describe('Print the most recent review for the current working directory.')
      .arguments(z.object({ json: z.boolean().default(false).describe('Print JSON') }))
      .action((args) => review(args)),
  )
  .command('hook', (c) =>
    c.describe('Handle harness hook events.').command('claude', (c) =>
      c
        .describe('Handle a Claude Code hook event.')
        .arguments(z.object({ event: z.enum(HOOK_EVENTS).describe('Hook event') }), { positional: ['event'] })
        .action((args) => hookClaude(args.event)),
    ),
  );

if (import.meta.main) await program.cli();
