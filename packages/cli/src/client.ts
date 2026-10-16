// Calls the review server's API, typed from the contract in
// @agent-diff/shared (decision 0011).
import { createORPCClient, ORPCError } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import { apiPrefix, type Contract } from '@agent-diff/shared/contract';
import { readConfig, serverUrl, statePaths } from '@agent-diff/shared/state';

export type Client = ContractRouterClient<Contract>;

// From decision 0019.
export const notRunningMessage =
  "The review server isn't running. Start it with `agent-diff server start`.";

export function createClient(port: number): Client {
  return createORPCClient(
    new RPCLink({ url: new URL(apiPrefix, serverUrl(port)) }),
  );
}

// Whether a review server answers `health` on the port.
export async function isRunning(port: number): Promise<boolean> {
  try {
    const { ok } = await createClient(port).health(undefined, {
      signal: AbortSignal.timeout(2000),
    });
    return ok;
  } catch {
    return false;
  }
}

// Calls the API on the saved port. Fails with 0019's error when there's no
// saved port or nothing answers on it, and with the review server's message,
// such as a validation error, when it rejects the call.
export async function callReviewServer<T>(
  env: NodeJS.ProcessEnv,
  call: (client: Client) => Promise<T>,
): Promise<T> {
  const config = readConfig(statePaths(env));
  if (!config) throw new Error(notRunningMessage);
  try {
    return await call(createClient(config.port));
  } catch (error) {
    if (error instanceof ORPCError) throw new Error(error.message);
    throw new Error(notRunningMessage);
  }
}
