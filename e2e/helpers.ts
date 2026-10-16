// Starts the review server, and the review UI's dev server, as a user would,
// with a temporary XDG_STATE_HOME, so the tests never use the real state
// directory.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test as base } from '@playwright/test';

const root = path.join(import.meta.dirname, '..');
const bin = path.join(root, 'node_modules', '.bin', 'agent-diff');

export interface Running {
  // The URL with the token, as printed.
  url: string;
  // The URL without the token.
  origin: string;
  token: string;
}

// Spawns a command and waits for its output to match pattern. stop() ends the
// command and everything it started.
async function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  pattern: RegExp,
): Promise<{ match: RegExpExecArray; stop(): Promise<void> }> {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...env, NO_COLOR: '1' },
    // Its own process group, so stop() also ends what npm starts.
    detached: true,
  });
  const exited = once(child, 'exit');
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    process.kill(-child.pid!, 'SIGINT');
    await exited;
  };
  let output = '';
  child.stderr.setEncoding('utf8').on('data', (text) => (output += text));
  try {
    const match = await new Promise<RegExpExecArray>((resolve, reject) => {
      child.stdout.setEncoding('utf8').on('data', (text) => {
        output += text;
        const match = pattern.exec(output);
        if (match) resolve(match);
      });
      exited.then(() => reject(new Error(`${command} exited:\n${output}`)));
      // Within Playwright's 30 seconds for a test, so the command is stopped
      // below rather than left running.
      setTimeout(
        () => reject(new Error(`${command} printed no URL:\n${output}`)),
        20_000,
      ).unref();
    });
    return { match, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

export const test = base.extend<{
  stateHome: string;
  reviewServer: Running;
  devServer: Running;
}>({
  stateHome: async ({}, use) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'agent-diff-e2e-'));
    await use(dir);
    rmSync(dir, { recursive: true, force: true });
  },
  // `agent-diff server start --foreground`, serving the built review UI.
  reviewServer: async ({ stateHome }, use) => {
    const { match, stop } = await run(
      bin,
      ['server', 'start', '--foreground'],
      { XDG_STATE_HOME: stateHome },
      /running at ((http:\/\/127\.0\.0\.1:\d+\/)#token=([A-Za-z0-9_-]+))\n/,
    );
    await use({ url: match[1]!, origin: match[2]!, token: match[3]! });
    await stop();
  },
  // `npm run dev:ui`, proxying API calls to the review server, which has to
  // be started first, so the dev server can read its port and token.
  devServer: async ({ stateHome, reviewServer }, use) => {
    void reviewServer;
    const port = await freePort();
    const { match, stop } = await run(
      'npm',
      ['run', 'dev:ui', '--', '--port', String(port), '--strictPort'],
      { XDG_STATE_HOME: stateHome },
      /((http:\/\/localhost:\d+\/)#token=([A-Za-z0-9_-]+))\s/,
    );
    await use({ url: match[1]!, origin: match[2]!, token: match[3]! });
    await stop();
  },
});
