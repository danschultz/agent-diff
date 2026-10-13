import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Effect, Option } from 'effect';
import { Argument, Command, Flag } from 'effect/cli';
import { HOOK_EVENTS, hookClaude, review, start } from '../shared.ts';

const startCommand = Command.make(
  'start',
  {
    paths: Argument.String('path').pipe(
      Argument.withDescription('Working directories to review (default: the current directory)'),
      Argument.variadic(),
    ),
    base: Flag.String('base').pipe(Flag.withDescription('Base ref to compare against'), Flag.optional),
    title: Flag.String('title').pipe(Flag.withDescription('Title for the review session'), Flag.optional),
    open: Flag.Boolean('open').pipe(Flag.withDescription('Open the review UI in a browser'), Flag.withDefault(false)),
  },
  ({ paths, base, title, open }) =>
    Effect.sync(() => start({ paths: [...paths], base: Option.getOrUndefined(base), title: Option.getOrUndefined(title), open })),
).pipe(Command.withDescription('Start a review session over one or more working directories.'));

const reviewCommand = Command.make(
  'review',
  { json: Flag.Boolean('json').pipe(Flag.withDescription('Print JSON'), Flag.withDefault(false)) },
  ({ json }) => Effect.sync(() => review({ json })),
).pipe(Command.withDescription('Print the most recent review for the current working directory.'));

const hookClaudeCommand = Command.make(
  'claude',
  { event: Argument.Literals('event', HOOK_EVENTS).pipe(Argument.withDescription('Hook event')) },
  ({ event }) => Effect.sync(() => hookClaude(event)),
).pipe(Command.withDescription('Handle a Claude Code hook event.'));

const hookCommand = Command.make('hook').pipe(
  Command.withDescription('Handle harness hook events.'),
  Command.withSubcommands([hookClaudeCommand]),
);

export const app = Command.make('agent-diff').pipe(
  Command.withDescription('Review changes made by coding agents.'),
  Command.withSubcommands([startCommand, reviewCommand, hookCommand]),
);

if (import.meta.main) {
  app.pipe(Command.run({ version: '0.0.0' }), Effect.provide(NodeServices.layer), NodeRuntime.runMain);
}
