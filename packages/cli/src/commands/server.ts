// `agent-diff server` commands, from decisions 0019 and 0020.
import { once } from 'node:events';
import { defineCommand } from '@crustjs/core';
import { readConfig, statePaths } from '@agent-diff/shared/state';
import { isRunning } from '../client.ts';

export interface ServerCommandOptions {
  env: NodeJS.ProcessEnv;
}

// Resolves when the signal is aborted, such as by Crust on the first SIGINT,
// or when the process gets SIGTERM.
async function stopRequested(signal: AbortSignal): Promise<void> {
  const controller = new AbortController();
  const onSigterm = () => controller.abort();
  process.on('SIGTERM', onSigterm);
  try {
    await once(AbortSignal.any([signal, controller.signal]), 'abort');
  } finally {
    process.off('SIGTERM', onSigterm);
  }
}

export function serverCommand({ env }: ServerCommandOptions) {
  const start = defineCommand(
    'start',
    { description: 'Start the review server.' },
    (c) =>
      c
        .flags({
          name: 'foreground',
          type: 'boolean',
          default: false,
          description: 'Run in the foreground until stopped with Ctrl-C',
        })
        .action(async ({ flags, stdout, signal }) => {
          if (!flags.foreground) {
            throw new Error(
              'Only `agent-diff server start --foreground` is supported for now.',
            );
          }
          // Something that answers on the saved port but rejects the token,
          // such as another user's review server, doesn't count, and the
          // review server started below moves to a new port (0024).
          const saved = readConfig(statePaths(env));
          if (saved && (await isRunning(saved.port, saved.token))) {
            stdout(
              `The review server is already running on port ${saved.port}.`,
            );
            return;
          }
          // Loaded here, so other commands don't pay for loading the review
          // server.
          const { startReviewServer } = await import('@agent-diff/server');
          const server = await startReviewServer({ env });
          // Only `session new` and `session show` print a link with the
          // token (decision 0040).
          stdout(
            `The review server is running on port ${server.port}.\nPress Ctrl-C to stop it.`,
          );
          await stopRequested(signal);
          await server.close();
          stdout('The review server stopped.');
        }),
  );

  return defineCommand(
    'server',
    { description: 'Manage the review server.' },
    (c) => c.add(start),
  );
}
