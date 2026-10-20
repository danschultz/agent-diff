import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import type { Contract } from '@agent-diff/shared/contract';
import {
  startReviewServer,
  type ReviewServer,
  type StartOptions,
} from '../src/server.ts';

// A temporary XDG_STATE_HOME, so tests never use the real state directory.
export function tempStateHome(t: TestContext): NodeJS.ProcessEnv {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agent-diff-server-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { XDG_STATE_HOME: dir };
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
