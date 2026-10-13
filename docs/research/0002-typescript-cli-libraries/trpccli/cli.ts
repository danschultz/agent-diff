import { createCli, t } from 'trpc-cli';
import { z } from 'zod';
import { HOOK_EVENTS, hookClaude, review, start } from '../shared.ts';

export const router = t.router({
  start: t.procedure
    .meta({ description: 'Start a review session over one or more working directories.' })
    .input(
      z.tuple([
        z.array(z.string()).default([]).describe('path'),
        z.object({
          base: z.string().optional().describe('Base ref to compare against'),
          title: z.string().optional().describe('Title for the review session'),
          open: z.boolean().default(false).describe('Open the review UI in a browser'),
        }),
      ]),
    )
    .handler(({ input: [paths, opts] }) => start({ paths, ...opts })),
  review: t.procedure
    .meta({ description: 'Print the most recent review for the current working directory.' })
    .input(z.object({ json: z.boolean().default(false).describe('Print JSON') }))
    .handler(({ input }) => review(input)),
  hook: t.router({
    claude: t.procedure
      .meta({ description: 'Handle a Claude Code hook event.' })
      .input(z.enum(HOOK_EVENTS).describe('event'))
      .handler(({ input }) => hookClaude(input)),
  }),
});

export const cli = createCli({ router, name: 'agent-diff', description: 'Review changes made by coding agents.' });

if (import.meta.main) await cli.run();
