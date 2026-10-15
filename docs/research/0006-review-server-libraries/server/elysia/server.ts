import { node } from '@elysia/node';
import { Elysia, sse } from 'elysia';
import * as z from 'zod';
import { checkRequest, port } from './shared/config.ts';
import {
  AddComment,
  Comment,
  CreateReviewSession,
  ErrorBody,
  ReviewSession,
} from './shared/schemas.ts';
import { Store } from './shared/store.ts';

const store = new Store();

const app = new Elysia({ adapter: node() })
  .onError(({ code, error, status }) => {
    if (code === 'VALIDATION') return status(400, { error: error.message });
  })
  .onRequest(({ request, status }) => {
    const denied = checkRequest(
      request.headers.get('host'),
      request.headers.get('authorization'),
    );
    if (denied) return status(denied.status, { error: denied.error });
  })
  .get('/api/health', () => ({ ok: true }))
  .get('/api/events', async function* ({ request }) {
    const queue: Comment[] = [];
    let wake = () => {};
    const stop = store.onComment((c) => {
      queue.push(c);
      wake();
    });
    request.signal.addEventListener('abort', () => wake());
    try {
      yield sse({ event: 'connected', data: '' });
      while (!request.signal.aborted) {
        const comment = queue.shift();
        if (comment) yield sse({ event: 'comment-added', data: comment });
        else await new Promise<void>((resolve) => (wake = resolve));
      }
    } finally {
      stop();
    }
  })
  .post(
    '/api/review-sessions',
    ({ body, status }) => status(201, store.createReviewSession(body)),
    {
      body: CreateReviewSession,
      response: { 201: ReviewSession },
    },
  )
  .get(
    '/api/review-sessions/:id',
    ({ params, status }) =>
      store.getReviewSession(params.id) ??
      status(404, { error: 'Review session not found' }),
    {
      params: z.object({ id: z.string() }),
      response: { 200: ReviewSession, 404: ErrorBody },
    },
  )
  .post(
    '/api/review-sessions/:id/comments',
    ({ params, body, status }) => {
      const comment = store.addComment(params.id, body);
      return comment
        ? status(201, comment)
        : status(404, { error: 'Review session not found' });
    },
    {
      params: z.object({ id: z.string() }),
      body: AddComment,
      response: { 201: Comment, 404: ErrorBody },
    },
  );

export type App = typeof app;

if (import.meta.main) app.listen({ port, hostname: '127.0.0.1' });
