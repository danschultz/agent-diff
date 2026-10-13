import { Cli, Types, friendlyErrorPlugin, notFoundPlugin, strictFlagsPlugin } from 'clerc';
import { HOOK_EVENTS, hookClaude, review, start } from '../shared.ts';

export const cli = Cli({ name: 'agent-diff', scriptName: 'agent-diff', description: 'Review changes made by coding agents.', version: '0.0.0' })
  .use(notFoundPlugin())
  .use(strictFlagsPlugin())
  .use(friendlyErrorPlugin())
  .command('start', 'Start a review session over one or more working directories.', {
    parameters: [{ key: '[path...]', description: 'Working directories to review (default: the current directory)' }],
    flags: {
      base: { type: String, description: 'Base ref to compare against' },
      title: { type: String, description: 'Title for the review session' },
      open: { type: Boolean, default: false, description: 'Open the review UI in a browser' },
    },
  })
  .command('review', 'Print the most recent review for the current working directory.', {
    flags: { json: { type: Boolean, default: false, description: 'Print JSON' } },
  })
  .command('hook claude', 'Handle a Claude Code hook event.', {
    parameters: [{ key: '<event>', type: Types.Enum(...HOOK_EVENTS), description: 'Hook event' }],
  })
  .on('start', ({ parameters, flags }) =>
    start({ paths: parameters.path, base: flags.base, title: flags.title, open: flags.open }),
  )
  .on('review', ({ flags }) => review({ json: flags.json }))
  .on('hook claude', ({ parameters }) => hookClaude(parameters.event));

if (import.meta.main) await cli.parse();
