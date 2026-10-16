// Starts the review server with `agent-diff server start --foreground`, as a
// user would, and checks that the review UI it serves shows the `hello`
// endpoint's message.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const bin = path.join(
  import.meta.dirname,
  '..',
  'node_modules',
  '.bin',
  'agent-diff',
);

test('the review UI shows the hello message', async ({ page }) => {
  // A temporary XDG_STATE_HOME, so the test never uses the real state
  // directory.
  const stateHome = mkdtempSync(path.join(os.tmpdir(), 'agent-diff-e2e-'));
  const server = spawn(bin, ['server', 'start', '--foreground'], {
    env: { ...process.env, XDG_STATE_HOME: stateHome },
  });
  const exited = once(server, 'exit');
  try {
    let output = '';
    server.stderr.setEncoding('utf8').on('data', (text) => (output += text));
    const url = await new Promise<string>((resolve, reject) => {
      server.stdout.setEncoding('utf8').on('data', (text) => {
        output += text;
        const match = /running at (http:\/\/127\.0\.0\.1:\d+\/)/.exec(output);
        if (match) resolve(match[1]!);
      });
      exited.then(() =>
        reject(new Error(`The review server exited:\n${output}`)),
      );
    });

    await page.goto(url);
    await expect(
      page.getByRole('heading', { name: 'Hello, world!' }),
    ).toBeVisible();
  } finally {
    server.kill('SIGINT');
    await exited;
    rmSync(stateHome, { recursive: true, force: true });
  }
});
