// Calls the review server's API, typed from the contract in
// @agent-diff/shared, with the saved token. The review server serves the
// review UI, so the API is on the same origin. In development, Vite's dev
// server proxies it.
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import { apiPrefix, type Contract } from '@agent-diff/shared/contract';
import { savedToken } from './token.ts';

export const client: ContractRouterClient<Contract> = createORPCClient(
  new RPCLink({
    url: new URL(apiPrefix, window.location.origin),
    // Read on every call, including calls that return event iterators.
    headers: (): Record<string, string> => {
      const token = savedToken();
      return token ? { authorization: `Bearer ${token}` } : {};
    },
  }),
);
