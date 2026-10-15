import { createORPCClient, ORPCError } from '@orpc/client';
import type { ContractRouterClient } from '@orpc/contract';
import type { JsonifiedClient } from '@orpc/openapi-client';
import { OpenAPILink } from '@orpc/openapi-client/fetch';
import { contract } from './contract.ts';
import { baseUrl, token } from './shared/config.ts';
import { notAny } from './shared/probe.ts';
import { normalize } from './shared/sse.ts';

const link = new OpenAPILink(contract, {
  url: `${baseUrl}/api`,
  headers: { authorization: `Bearer ${token}` },
});
const client: JsonifiedClient<ContractRouterClient<typeof contract>> =
  createORPCClient(link);

async function result<T>(call: Promise<T>, status = 200) {
  try {
    return { status, body: await call };
  } catch (error) {
    if (!(error instanceof ORPCError)) throw error;
    return { status: error.status, body: { error: error.message } };
  }
}

const events = await client.events();
const event = (async () => {
  for await (const data of events) return { event: 'comment-added', data };
})();

const created = await client.reviewSessions.create({
  workingDirectories: ['/repo/a', '/repo/b'],
  title: 'Example',
});
const id = notAny(created).id;
const added = await result(
  client.reviewSessions.addComment({
    params: { id },
    body: { path: 'src/a.ts', startLine: 3, endLine: 4, body: 'Rename this.' },
  }),
  201,
);
const invalid = await result(
  client.reviewSessions.addComment({
    params: { id },
    body: { path: 'src/a.ts', startLine: 5, endLine: 2, body: '' },
  }),
);
const fetched = await result(client.reviewSessions.get({ id }));
const missing = await result(client.reviewSessions.get({ id: 'nope' }));

console.log(
  JSON.stringify(
    normalize({
      created: { status: 201, body: created },
      added,
      invalid,
      fetched,
      missing,
      event: await event,
    }),
    null,
    2,
  ),
);
