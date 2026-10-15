import { createTRPCClient, httpLink } from '@trpc/client';
import type { Router } from './server.ts';
import { baseUrl } from './shared/config.ts';
console.log(
  typeof createTRPCClient<Router>({ links: [httpLink({ url: baseUrl })] }),
);
