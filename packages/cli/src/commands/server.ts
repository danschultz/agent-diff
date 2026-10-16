// `agent-diff server` commands, from decisions 0019 and 0020.
import { once } from 'node:events';
import { defineCommand } from '@crustjs/core';
import { readConfig, serverUrl, statePaths } from '@agent-diff/shared/state';
import { callReviewServer, isRunning } from '../client.ts';

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
          const saved = readConfig(statePaths(env));
          if (saved && (await isRunning(saved.port))) {
            stdout(
              `The review server is already running at ${serverUrl(saved.port)}`,
            );
            return;
          }
          // Loaded here, so other commands don't pay for loading the review
          // server.
          const { startReviewServer } = await import('@agent-diff/server');
          const server = await startReviewServer({ env });
          stdout(
            `The review server is running at ${server.url}\nPress Ctrl-C to stop it.`,
          );
          await stopRequested(signal);
          await server.close();
          stdout('The review server stopped.');
        }),
  );

  // Placeholder for the hello world scaffolding. Remove it when real features
  // land.
  const hello = defineCommand(
    'hello',
    { description: "Call the review server's hello endpoint." },
    (c) =>
      c
        .args({
          name: 'name',
          type: 'string',
          required: true,
          description: 'Who to greet',
        })
        .action(async ({ args, stdout }) => {
          const { message, count } = await callReviewServer(env, (client) =>
            client.hello({ name: args.name }),
          );
          stdout(
            `${message} (${count} ${count === 1 ? 'greeting' : 'greetings'})`,
          );
        }),
  );

  return defineCommand(
    'server',
    { description: 'Manage the review server.' },
    (c) => c.add(start, hello),
  );
}
