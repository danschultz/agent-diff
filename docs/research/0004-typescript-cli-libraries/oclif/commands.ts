import { Args, Command, Flags } from '@oclif/core';
import { HOOK_EVENTS, hookClaude, review, start } from '../shared.ts';

class Start extends Command {
  static override description = 'Start a review session over one or more working directories.';
  static override strict = false; // allow several <path> arguments
  static override args = {
    path: Args.string({ description: 'Working directories to review (default: the current directory)' }),
  };
  static override flags = {
    base: Flags.string({ description: 'Base ref to compare against' }),
    title: Flags.string({ description: 'Title for the review session' }),
    open: Flags.boolean({ description: 'Open the review UI in a browser', default: false }),
  };
  async run() {
    const { argv, flags } = await this.parse(Start);
    start({ paths: argv as string[], ...flags });
  }
}

class Review extends Command {
  static override description = 'Print the most recent review for the current working directory.';
  static override flags = { json: Flags.boolean({ description: 'Print JSON', default: false }) };
  async run() {
    const { flags } = await this.parse(Review);
    review(flags);
  }
}

class HookClaude extends Command {
  static override description = 'Handle a Claude Code hook event.';
  static override args = {
    event: Args.string({ description: 'Hook event', options: [...HOOK_EVENTS], required: true }),
  };
  async run() {
    const { args } = await this.parse(HookClaude);
    hookClaude(args.event as (typeof HOOK_EVENTS)[number]);
  }
}

export const COMMANDS = { start: Start, review: Review, 'hook:claude': HookClaude };
