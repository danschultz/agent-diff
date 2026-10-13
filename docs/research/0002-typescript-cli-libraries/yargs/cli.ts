import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { HOOK_EVENTS, hookClaude, review, start } from '../shared.ts';

export function makeParser(argv: string[]) {
  return yargs(argv)
    .scriptName('agent-diff')
    .usage('$0 <command>\n\nReview changes made by coding agents.')
    .command(
      'start [path..]',
      'Start a review session over one or more working directories.',
      (y) =>
        y
          .positional('path', {
            type: 'string',
            array: true,
            default: [] as string[],
            describe: 'Working directories to review (default: the current directory)',
          })
          .option('base', { type: 'string', describe: 'Base ref to compare against' })
          .option('title', { type: 'string', describe: 'Title for the review session' })
          .option('open', { type: 'boolean', default: false, describe: 'Open the review UI in a browser' }),
      (a) => start({ paths: a.path, base: a.base, title: a.title, open: a.open }),
    )
    .command(
      'review',
      'Print the most recent review for the current working directory.',
      (y) => y.option('json', { type: 'boolean', default: false, describe: 'Print JSON' }),
      (a) => review({ json: a.json }),
    )
    .command('hook', 'Handle harness hook events.', (y) =>
      y
        .command(
          'claude <event>',
          'Handle a Claude Code hook event.',
          (y) => y.positional('event', { choices: HOOK_EVENTS, demandOption: true, describe: 'Hook event' }),
          (a) => hookClaude(a.event),
        )
        .demandCommand(1),
    )
    .demandCommand(1)
    .strict()
    .recommendCommands();
}

await makeParser(hideBin(process.argv)).parseAsync();
