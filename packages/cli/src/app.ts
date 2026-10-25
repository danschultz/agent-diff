// The `agent-diff` CLI, built with Crust (decision 0017). Commands are noun
// then verb (0020).
import { Crust } from '@crustjs/core';
import { didYouMean, help } from '@crustjs/extensions';
import { confirmInTerminal, type Confirm } from './confirm.ts';
import { commentCommand, reviewCommand } from './commands/review.ts';
import { serverCommand } from './commands/server.ts';
import { sessionCommand } from './commands/session.ts';

export interface AppOptions {
  // Where the state directory is found, through `XDG_STATE_HOME`. Tests pass
  // a temporary one.
  env?: NodeJS.ProcessEnv;
  // What relative paths are resolved against. Defaults to the current
  // directory.
  cwd?: string;
  // Asks a yes-or-no question, or is null when there's no terminal to ask
  // in. Defaults to asking on stdin when it's a terminal.
  confirm?: Confirm | null;
}

export function createApp({
  env = process.env,
  cwd = process.cwd(),
  confirm = process.stdin.isTTY ? confirmInTerminal : null,
}: AppOptions = {}) {
  return new Crust('agent-diff', {
    description: 'Review changes made by coding agents.',
  })
    .extend(help(), didYouMean())
    .add(serverCommand({ env }))
    .add(sessionCommand({ env, cwd, confirm }))
    .add(reviewCommand({ env }))
    .add(commentCommand({ env }));
}
