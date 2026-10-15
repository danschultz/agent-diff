// The `agent-diff` CLI, built with Crust (decision 0017). Commands are noun
// then verb (0020).
import { Crust } from '@crustjs/core';
import { didYouMean, help } from '@crustjs/extensions';
import { serverCommand } from './commands/server.ts';

export interface AppOptions {
  // Where the state directory is found, through `XDG_STATE_HOME`. Tests pass
  // a temporary one.
  env?: NodeJS.ProcessEnv;
}

export function createApp({ env = process.env }: AppOptions = {}) {
  return new Crust('agent-diff', {
    description: 'Review changes made by coding agents.',
  })
    .extend(help(), didYouMean())
    .add(serverCommand({ env }));
}
