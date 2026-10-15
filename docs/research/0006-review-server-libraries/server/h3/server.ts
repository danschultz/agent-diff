import { EventStream, H3, HTTPError, readValidatedBody, serve } from 'h3';
import * as z from 'zod';
import { checkRequest, port } from './shared/config.ts';
import { AddComment, CreateReviewSession } from './shared/schemas.ts';
import { Store } from './shared/store.ts';

const store = new Store();

const onError = (result: { issues: readonly unknown[] }) => ({
  status: 400,
  message: z.prettifyError(new z.ZodError(result.issues as z.core.$ZodIssue[])),
});

const app = new H3({
  onError: (error) =>
    Response.json({ error: error.message }, { status: error.status }),
})
  .use('/api/**', (event) => {
    const denied = checkRequest(
      event.req.headers.get('host'),
      event.req.headers.get('authorization'),
    );
    if (denied)
      throw new HTTPError({ status: denied.status, message: denied.error });
  })
  .get('/api/health', () => ({ ok: true }))
  .get('/api/events', (event) => {
    const stream = new EventStream(event);
    void stream.pushComment('connected');
    const stop = store.onComment((c) =>
      stream.push({ event: 'comment-added', data: JSON.stringify(c) }),
    );
    stream.onClosed(stop);
    return stream;
  })
  .post('/api/review-sessions', async (event) => {
    const input = await readValidatedBody(event, CreateReviewSession, {
      onError,
    });
    event.res.status = 201;
    return store.createReviewSession(input);
  })
  .get('/api/review-sessions/:id', (event) => {
    const session = store.getReviewSession(event.context.params!.id!);
    if (!session)
      throw new HTTPError({ status: 404, message: 'Review session not found' });
    return session;
  })
  .post('/api/review-sessions/:id/comments', async (event) => {
    const input = await readValidatedBody(event, AddComment, { onError });
    const comment = store.addComment(event.context.params!.id!, input);
    if (!comment)
      throw new HTTPError({ status: 404, message: 'Review session not found' });
    event.res.status = 201;
    return comment;
  });

serve(app, { port, hostname: '127.0.0.1', silent: true });
