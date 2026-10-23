import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import type { Contract } from '@agent-diff/shared/contract';
import { gitTestEnv } from '../../../scripts/test/git-env.ts';
import {
  startReviewServer,
  type ReviewServer,
  type StartOptions,
} from '../src/server.ts';

// A temporary directory, by its real path, removed when the test ends.
export function tempDir(t: TestContext, prefix = 'agent-diff-server-'): string {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A temporary XDG_STATE_HOME, so tests never use the real state directory,
// on top of the environment for running git, which the review server runs
// with the environment it's given.
export function tempStateHome(t: TestContext): NodeJS.ProcessEnv {
  return { ...gitTestEnv(t), XDG_STATE_HOME: tempDir(t) };
}

// Runs git in dir and returns its output, trimmed.
export function git(
  env: NodeJS.ProcessEnv,
  dir: string,
  ...args: string[]
): string {
  return execFileSync('git', args, { cwd: dir, env, encoding: 'utf8' }).trim();
}

export function commit(env: NodeJS.ProcessEnv, dir: string): void {
  git(
    env,
    dir,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '--quiet',
    '--allow-empty',
    '--message',
    'Commit',
  );
}

// A new repo with HEAD on branch, and one commit unless there are none.
export function makeRepo(
  t: TestContext,
  env: NodeJS.ProcessEnv,
  { branch = 'main', commits = 1 }: { branch?: string; commits?: 0 | 1 } = {},
): string {
  const dir = tempDir(t, 'agent-diff-repo-');
  git(env, dir, 'init', '--quiet', '--initial-branch', branch);
  if (commits) commit(env, dir);
  return dir;
}

// Starts a review server that's stopped when the test ends, if the test
// hasn't stopped it already.
export async function start(
  t: TestContext,
  options: StartOptions,
): Promise<ReviewServer> {
  const server = await startReviewServer(options);
  let closed = false;
  const close = server.close;
  server.close = async () => {
    closed = true;
    await close();
  };
  t.after(() => (closed ? undefined : server.close()));
  return server;
}

// A client that sends the token, the review server's own unless another is
// given. With `null`, it sends none.
export function client(
  server: ReviewServer,
  token: string | null = server.token,
): ContractRouterClient<Contract> {
  return createORPCClient(
    new RPCLink({
      url: `${server.url}api`,
      headers: token === null ? {} : { authorization: `Bearer ${token}` },
    }),
  );
}
