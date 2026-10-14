import { Builtins, Cli, Command, Option } from 'clipanion';
import * as t from 'typanion';
import { HOOK_EVENTS, hookClaude, review, start } from '../shared.ts';

class StartCommand extends Command {
  static override paths = [['start']];
  static override usage = Command.Usage({
    description: 'Start a review session over one or more working directories.',
    examples: [['Review the current directory against main', '$0 start --base main']],
  });
  base = Option.String('--base', { description: 'Base ref to compare against' });
  title = Option.String('--title', { description: 'Title for the review session' });
  open = Option.Boolean('--open', false, { description: 'Open the review UI in a browser' });
  path = Option.Rest({ name: 'path' });
  async execute() {
    start({ paths: this.path, base: this.base, title: this.title, open: this.open });
  }
}

class ReviewCommand extends Command {
  static override paths = [['review']];
  static override usage = Command.Usage({
    description: 'Print the most recent review for the current working directory.',
  });
  json = Option.Boolean('--json', false, { description: 'Print JSON' });
  async execute() {
    review({ json: this.json });
  }
}

class HookClaudeCommand extends Command {
  static override paths = [['hook', 'claude']];
  static override usage = Command.Usage({ description: 'Handle a Claude Code hook event.' });
  event = Option.String({ name: 'event', validator: t.isEnum(HOOK_EVENTS) });
  async execute() {
    hookClaude(this.event);
  }
}

export const cli = new Cli({ binaryLabel: 'agent-diff', binaryName: 'agent-diff' });
cli.register(StartCommand);
cli.register(ReviewCommand);
cli.register(HookClaudeCommand);
cli.register(Builtins.HelpCommand);
cli.register(Builtins.DefinitionsCommand);

if (import.meta.main) await cli.runExit(process.argv.slice(2));
