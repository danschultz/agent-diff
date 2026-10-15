import { createORPCClient } from '@orpc/client';
import type { ContractRouterClient } from '@orpc/contract';
import { OpenAPILink } from '@orpc/openapi-client/fetch';
import { contract } from './contract.ts';
import { baseUrl } from './shared/config.ts';
const c: ContractRouterClient<typeof contract> = createORPCClient(
  new OpenAPILink(contract, { url: baseUrl }),
);
console.log(typeof c);
