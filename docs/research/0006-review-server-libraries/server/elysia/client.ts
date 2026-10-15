import { treaty } from '@elysiajs/eden';
import type { App } from './server.ts';
import { baseUrl, token } from './shared/config.ts';
import { notAny } from './shared/probe.ts';
import { normalize } from './shared/sse.ts';

const client = treaty<App>(baseUrl, {
  headers: { authorization: `Bearer ${token}` },
});

const result = <
  T extends { status: number; data: unknown; error: { value: unknown } | null },
>(
  r: T,
) => ({
  status: r.status,
  body: r.error ? r.error.value : r.data,
});

// Leaving the loop doesn't close the stream, so abort it.
const stream = new AbortController();
const events = await client.api.events.get({
  fetch: { signal: stream.signal },
});
if (events.error) throw new Error(`events: HTTP ${events.status}`);
const event = (async () => {
  for await (const message of events.data) {
    if (message.event !== 'comment-added') continue;
    stream.abort();
    return message;
  }
})();

const created = await client.api['review-sessions'].post({
  workingDirectories: ['/repo/a', '/repo/b'],
  title: 'Example',
});
if (created.error) throw new Error(JSON.stringify(created.error.value));
const id = notAny(created.data).id;
const session = client.api['review-sessions']({ id });
const added = result(
  await session.comments.post({
    path: 'src/a.ts',
    startLine: 3,
    endLine: 4,
    body: 'Rename this.',
  }),
);
const invalid = result(
  await session.comments.post({
    path: 'src/a.ts',
    startLine: 5,
    endLine: 2,
    body: '',
  }),
);
const fetched = result(await session.get());
const missing = result(
  await client.api['review-sessions']({ id: 'nope' }).get(),
);

console.log(
  JSON.stringify(
    normalize({
      created: result(created),
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
