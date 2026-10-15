import { hc } from 'hono/client';
import type { App } from './server.ts';
import { baseUrl, token } from './shared/config.ts';
import { firstEvent, normalize } from './shared/sse.ts';

const headers = { authorization: `Bearer ${token}` };
const client = hc<App>(baseUrl, { headers });

const result = async <R extends { status: number; json(): Promise<unknown> }>(
  res: R,
) => ({
  status: res.status,
  body: (await res.json()) as Awaited<ReturnType<R['json']>>,
});

let ready!: () => void;
const listening = new Promise<void>((resolve) => (ready = resolve));
const event = firstEvent(`${baseUrl}/api/events`, headers, ready);
await listening;

const created = await result(
  await client.api['review-sessions'].$post({
    json: { workingDirectories: ['/repo/a', '/repo/b'], title: 'Example' },
  }),
);
if ('error' in created.body) throw new Error(created.body.error);
const id = created.body.id;
const comments = client.api['review-sessions'][':id'].comments;
const added = await result(
  await comments.$post({
    param: { id },
    json: { path: 'src/a.ts', startLine: 3, endLine: 4, body: 'Rename this.' },
  }),
);
const invalid = await result(
  await comments.$post({
    param: { id },
    json: { path: 'src/a.ts', startLine: 5, endLine: 2, body: '' },
  }),
);
const fetched = await result(
  await client.api['review-sessions'][':id'].$get({ param: { id } }),
);
const missing = await result(
  await client.api['review-sessions'][':id'].$get({ param: { id: 'nope' } }),
);

console.log(
  JSON.stringify(
    normalize({
      created,
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
