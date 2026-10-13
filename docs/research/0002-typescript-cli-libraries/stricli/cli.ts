import { buildApplication, buildChoiceParser, buildCommand, buildRouteMap, run } from '@stricli/core';
import { HOOK_EVENTS, hookClaude, review, start, type HookEvent } from '../shared.ts';

// Stricli infers parameter types from func's signature and checks the parameter specs against it.
type StartFlags = { readonly base?: string; readonly title?: string; readonly open: boolean };

const startCommand = buildCommand({
  docs: { brief: 'Start a review session over one or more working directories.' },
  parameters: {
    positional: {
      kind: 'array',
      parameter: { brief: 'Working directories to review (default: the current directory)', parse: String, placeholder: 'path' },
    },
    flags: {
      base: { kind: 'parsed', parse: String, brief: 'Base ref to compare against', optional: true, placeholder: 'ref' },
      title: { kind: 'parsed', parse: String, brief: 'Title for the review session', optional: true, placeholder: 'text' },
      open: { kind: 'boolean', brief: 'Open the review UI in a browser', default: false },
    },
  },
  func: (flags: StartFlags, ...paths: string[]) => start({ paths, ...flags }),
});

const reviewCommand = buildCommand({
  docs: { brief: 'Print the most recent review for the current working directory.' },
  parameters: { flags: { json: { kind: 'boolean', brief: 'Print JSON', default: false } } },
  func: (flags: { readonly json: boolean }) => review(flags),
});

const hookClaudeCommand = buildCommand({
  docs: { brief: 'Handle a Claude Code hook event.' },
  parameters: {
    positional: { kind: 'tuple', parameters: [{ brief: 'Hook event', parse: buildChoiceParser(HOOK_EVENTS), placeholder: 'event' }] },
  },
  func: (_flags: {}, event: HookEvent) => hookClaude(event),
});

const root = buildRouteMap({
  docs: { brief: 'Review changes made by coding agents.' },
  routes: {
    start: startCommand,
    review: reviewCommand,
    hook: buildRouteMap({ docs: { brief: 'Handle harness hook events.' }, routes: { claude: hookClaudeCommand } }),
  },
});

export const app = buildApplication(root, { name: 'agent-diff' });

if (import.meta.main) await run(app, process.argv.slice(2), { process });
