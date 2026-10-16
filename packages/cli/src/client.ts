// Calls the review server's API, typed from the contract in
// @agent-diff/shared (decision 0011), with the token from the config file
// (0031).
import { createORPCClient, ORPCError } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import { apiPrefix, type Contract } from '@agent-diff/shared/contract';
import { readConfig, serverUrl, statePaths } from '@agent-diff/shared/state';

export type Client = ContractRouterClient<Contract>;

// From decision 0019.
export const notRunningMessage =
  "The review server isn't running. Start it with `agent-diff server start`.";

// From decision 0031. Something answers on the port, but not the review
// server the config file's token belongs to, such as another user's.
export function rejectedTokenMessage(port: number, configPath: string): string {
  return `Something on port ${port} rejected the token in \`${configPath}\`. Start the review server with \`agent-diff server start\`.`;
}

export function createClient(port: number, token: string): Client {
  return createORPCClient(
    new RPCLink({
      url: new URL(apiPrefix, serverUrl(port)),
      headers: { authorization: `Bearer ${token}` },
    }),
  );
}

// Whether the review server the token belongs to answers `health` on the
// port. Anything else on the port, such as another user's review server that
// rejects the token, doesn't count.
export async function isRunning(port: number, token: string): Promise<boolean> {
  try {
    const { ok } = await createClient(port, token).health(undefined, {
      signal: AbortSignal.timeout(2000),
    });
    return ok;
  } catch {
    return false;
  }
}

// Calls the API on the saved port with the saved token. Fails with 0019's
// error when there's no saved port and token or nothing answers on the port,
// with 0031's error when the token is rejected, and with the review server's
// message, such as a validation error, when it rejects the call.
export async function callReviewServer<T>(
  env: NodeJS.ProcessEnv,
  call: (client: Client) => Promise<T>,
): Promise<T> {
  const paths = statePaths(env);
  const config = readConfig(paths);
  if (!config?.token) throw new Error(notRunningMessage);
  try {
    return await call(createClient(config.port, config.token));
  } catch (error) {
    if (error instanceof ORPCError && error.status === 401) {
      throw new Error(rejectedTokenMessage(config.port, paths.config));
    }
    if (error instanceof ORPCError) throw new Error(error.message);
    throw new Error(notRunningMessage);
  }
}
