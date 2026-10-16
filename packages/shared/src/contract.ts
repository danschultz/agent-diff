// The review server's API, declared contract-first. The review server
// implements it with `implement()` and serves it with `RPCHandler`, and the
// CLI and the review UI call it through `RPCLink`, typed as
// `ContractRouterClient<typeof contract>`. See decision 0025.
import { oc } from '@orpc/contract';
import { Health, HelloInput, HelloOutput } from './schemas.ts';

export const contract = {
  // `server start` calls this on the saved port to tell whether the review
  // server is already running.
  health: oc.output(Health),
  // Placeholder for the hello world scaffolding. Remove it when real features
  // land.
  hello: oc.input(HelloInput).output(HelloOutput),
};

export type Contract = typeof contract;

// The path the API is served under. Everything else is the review UI.
export const apiPrefix = '/api';
