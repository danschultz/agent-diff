// Implements the contract from @agent-diff/shared.
import { implement } from '@orpc/server';
import { contract } from '@agent-diff/shared/contract';
import type { Store } from './store.ts';

export function createRouter(store: Store) {
  const os = implement(contract);
  return os.router({
    health: os.health.handler(() => ({ ok: true as const })),
    // Placeholder for the hello world scaffolding. Remove it when real
    // features land.
    hello: os.hello.handler(({ input }) => ({
      message: `Hello, ${input.name}!`,
      count: store.addGreeting(input.name),
    })),
  });
}

export type Router = ReturnType<typeof createRouter>;
