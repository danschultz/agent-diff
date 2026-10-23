// Calls the review server's API, typed from the contract in
// @agent-diff/shared, with the saved token. The review server serves the
// review UI, so the API is on the same origin. In development, Vite's dev
// server proxies it.
import { createORPCClient, ORPCError } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import { QueryClient } from '@tanstack/react-query';
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

// Query and mutation options for TanStack Query, built from the contract,
// such as `orpc.session.show.queryOptions({ input: { id } })`.
export const orpc = createTanstackQueryUtils(client);

// A page shows what the API returned when it loaded, with no live updates,
// so data never goes stale and isn't fetched again on focus or reconnect.
// An error from the review server, such as a 401 or an unknown session, is
// its answer, so only a call that didn't reach it is retried.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: (failures, error) => !(error instanceof ORPCError) && failures < 3,
    },
  },
});
