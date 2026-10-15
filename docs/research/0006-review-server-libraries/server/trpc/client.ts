import {
  createTRPCClient,
  httpLink,
  httpSubscriptionLink,
  splitLink,
  TRPCClientError,
} from '@trpc/client';
import { EventSource } from 'eventsource';
import type { Router } from './server.ts';
import { baseUrl, token } from './shared/config.ts';
import { notAny } from './shared/probe.ts';
import { normalize } from './shared/sse.ts';

const headers = { authorization: `Bearer ${token}` };
const url = `${baseUrl}/api`;
const client = createTRPCClient<Router>({
  links: [
    splitLink({
      condition: (op) => op.type === 'subscription',
      true: httpSubscriptionLink({
        url,
        EventSource,
        eventSourceOptions: {
          fetch: (input, init) =>
            fetch(input, { ...init, headers: { ...init.headers, ...headers } }),
        },
      }),
      false: httpLink({ url, headers }),
    }),
  ],
});

async function result<T>(call: Promise<T>) {
  try {
    return { status: 200, body: await call };
  } catch (error) {
    if (!(error instanceof TRPCClientError)) throw error;
    return {
      status: error.data?.httpStatus as number,
      body: { error: error.message },
    };
  }
}

let ready!: () => void;
const listening = new Promise<void>((resolve) => (ready = resolve));
const event = new Promise((resolve) => {
  const sub = client.events.subscribe(undefined, {
    onStarted: ready,
    onData: (data) => {
      resolve({ event: 'comment-added', data });
      sub.unsubscribe();
    },
  });
});
await listening;

const created = await client.reviewSessions.create.mutate({
  workingDirectories: ['/repo/a', '/repo/b'],
  title: 'Example',
});
const id = notAny(created).id;
const added = await result(
  client.reviewSessions.addComment.mutate({
    id,
    comment: {
      path: 'src/a.ts',
      startLine: 3,
      endLine: 4,
      body: 'Rename this.',
    },
  }),
);
const invalid = await result(
  client.reviewSessions.addComment.mutate({
    id,
    comment: { path: 'src/a.ts', startLine: 5, endLine: 2, body: '' },
  }),
);
const fetched = await result(client.reviewSessions.get.query({ id }));
const missing = await result(client.reviewSessions.get.query({ id: 'nope' }));

console.log(
  JSON.stringify(
    normalize({
      created: { status: 200, body: created },
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
