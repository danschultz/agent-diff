// Calls the review server's API, typed from the contract in
// @agent-diff/shared. The review server serves the review UI, so the API is on
// the same origin. In development, Vite's dev server proxies it.
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import { apiPrefix, type Contract } from '@agent-diff/shared/contract';

export const client: ContractRouterClient<Contract> = createORPCClient(
  new RPCLink({ url: new URL(apiPrefix, window.location.origin) }),
);
