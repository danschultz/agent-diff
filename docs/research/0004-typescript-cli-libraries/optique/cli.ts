import { argument, choice, command, constant, message, multiple, object, option, optional, or, string } from '@optique/core';
import { run } from '@optique/run';
import { HOOK_EVENTS, hookClaude, review, start } from '../shared.ts';

const startCommand = command(
  'start',
  object({
    command: constant('start'),
    paths: multiple(argument(string({ metavar: 'PATH' }), { description: message`Working directories to review (default: the current directory)` })),
    base: optional(option('--base', string({ metavar: 'REF' }), { description: message`Base ref to compare against` })),
    title: optional(option('--title', string({ metavar: 'TEXT' }), { description: message`Title for the review session` })),
    open: option('--open', { description: message`Open the review UI in a browser` }),
  }),
  { description: message`Start a review session over one or more working directories.` },
);

const reviewCommand = command(
  'review',
  object({ command: constant('review'), json: option('--json', { description: message`Print JSON` }) }),
  { description: message`Print the most recent review for the current working directory.` },
);

const hookCommand = command(
  'hook',
  command(
    'claude',
    object({
      command: constant('hook claude'),
      event: argument(choice(HOOK_EVENTS, { metavar: 'EVENT' }), { description: message`Hook event` }),
    }),
    { description: message`Handle a Claude Code hook event.` },
  ),
  { description: message`Handle harness hook events.` },
);

export const parser = or(startCommand, reviewCommand, hookCommand);

export function main(args: readonly string[]) {
  const result = run(parser, {
    programName: 'agent-diff',
    args,
    brief: message`Review changes made by coding agents.`,
    help: 'both',
    completion: 'command',
    showChoices: true,
  });
  switch (result.command) {
    case 'start':
      return start({ paths: [...result.paths], base: result.base, title: result.title, open: result.open });
    case 'review':
      return review({ json: result.json });
    case 'hook claude':
      return hookClaude(result.event);
  }
}

if (import.meta.main) main(process.argv.slice(2));
