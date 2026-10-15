import { serve } from '@hono/node-server';
import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import * as z from 'zod';
import { checkRequest, port } from './shared/config.ts';
import { AddComment, CreateReviewSession } from './shared/schemas.ts';
import { Store } from './shared/store.ts';

const store = new Store();

const json = <S extends z.ZodType>(schema: S) =>
  sValidator('json', schema, (result, c) => {
    if (!result.success)
      return c.json(
        {
          error: z.prettifyError(
            new z.ZodError(result.error as z.core.$ZodIssue[]),
          ),
        },
        400,
      );
  });

const app = new Hono()
  .use('/api/*', async (c, next) => {
    const denied = checkRequest(
      c.req.header('host'),
      c.req.header('authorization'),
    );
    if (denied) return c.json({ error: denied.error }, denied.status);
    await next();
  })
  .get('/api/health', (c) => c.json({ ok: true }))
  .get('/api/events', (c) =>
    streamSSE(c, async (stream) => {
      const stop = store.onComment((comment) =>
        stream.writeSSE({
          event: 'comment-added',
          data: JSON.stringify(comment),
        }),
      );
      await new Promise<void>((resolve) => stream.onAbort(resolve));
      stop();
    }),
  )
  .post('/api/review-sessions', json(CreateReviewSession), (c) =>
    c.json(store.createReviewSession(c.req.valid('json')), 201),
  )
  .get('/api/review-sessions/:id', (c) => {
    const session = store.getReviewSession(c.req.param('id'));
    return session
      ? c.json(session, 200)
      : c.json({ error: 'Review session not found' }, 404);
  })
  .post('/api/review-sessions/:id/comments', json(AddComment), (c) => {
    const comment = store.addComment(c.req.param('id'), c.req.valid('json'));
    return comment
      ? c.json(comment, 201)
      : c.json({ error: 'Review session not found' }, 404);
  });

export type App = typeof app;

if (import.meta.main) serve({ fetch: app.fetch, port, hostname: '127.0.0.1' });
