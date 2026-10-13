import { Argument, Command } from '@commander-js/extra-typings';
import { HOOK_EVENTS, hookClaude, review, start } from '../shared.ts';

export function makeProgram() {
  const program = new Command('agent-diff').description('Review changes made by coding agents.');

  program
    .command('start')
    .description('Start a review session over one or more working directories.')
    .argument('[path...]', 'Working directories to review (default: the current directory)')
    .option('--base <ref>', 'Base ref to compare against')
    .option('--title <text>', 'Title for the review session')
    .option('--open', 'Open the review UI in a browser', false)
    .action((paths, opts) => start({ paths, ...opts }));

  program
    .command('review')
    .description('Print the most recent review for the current working directory.')
    .option('--json', 'Print JSON', false)
    .action((opts) => review(opts));

  const hook = program.command('hook').description('Handle harness hook events.');
  hook
    .command('claude')
    .description('Handle a Claude Code hook event.')
    .addArgument(new Argument('<event>', 'Hook event').choices(HOOK_EVENTS))
    .action((event) => hookClaude(event));

  return program;
}

await makeProgram().parseAsync();
