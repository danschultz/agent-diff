import * as z from 'zod';
import { baseUrl, token } from './shared/config.ts';
import {
  Comment,
  ErrorBody,
  ReviewSession,
  type AddComment,
  type CreateReviewSession,
} from './shared/schemas.ts';
import { firstEvent, normalize } from './shared/sse.ts';

const headers = {
  authorization: `Bearer ${token}`,
  'content-type': 'application/json',
};

async function call<T>(
  schema: z.ZodType<T>,
  method: string,
  path: string,
  body?: unknown,
) {
  const res = await fetch(baseUrl + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  return {
    status: res.status,
    body: res.ok ? schema.parse(json) : ErrorBody.parse(json),
  };
}

const createReviewSession = (input: CreateReviewSession) =>
  call(ReviewSession, 'POST', '/api/review-sessions', input);
const getReviewSession = (id: string) =>
  call(ReviewSession, 'GET', `/api/review-sessions/${id}`);
const addComment = (id: string, input: AddComment) =>
  call(Comment, 'POST', `/api/review-sessions/${id}/comments`, input);

let ready!: () => void;
const listening = new Promise<void>((resolve) => (ready = resolve));
const event = firstEvent(`${baseUrl}/api/events`, headers, ready);
await listening;

const created = await createReviewSession({
  workingDirectories: ['/repo/a', '/repo/b'],
  title: 'Example',
});
if ('error' in created.body) throw new Error(created.body.error);
const id = created.body.id;
const added = await addComment(id, {
  path: 'src/a.ts',
  startLine: 3,
  endLine: 4,
  body: 'Rename this.',
});
const invalid = await addComment(id, {
  path: 'src/a.ts',
  startLine: 5,
  endLine: 2,
  body: '',
});
const fetched = await getReviewSession(id);
const missing = await getReviewSession('nope');

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
