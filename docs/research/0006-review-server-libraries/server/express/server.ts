import express, { type Response } from 'express';
import * as z from 'zod';
import { checkRequest, port } from './shared/config.ts';
import { AddComment, CreateReviewSession } from './shared/schemas.ts';
import { Store } from './shared/store.ts';

const store = new Store();
const app = express();
app.use(express.json());

function parse<T>(
  schema: z.ZodType<T>,
  value: unknown,
  res: Response,
): T | undefined {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  res.status(400).json({ error: z.prettifyError(result.error) });
}

app.use('/api', (req, res, next) => {
  const denied = checkRequest(req.headers.host, req.headers.authorization);
  if (denied) res.status(denied.status).json({ error: denied.error });
  else next();
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
  });
  res.write(': connected\n\n');
  const stop = store.onComment((c) =>
    res.write(`event: comment-added\ndata: ${JSON.stringify(c)}\n\n`),
  );
  req.on('close', stop);
});

app.post('/api/review-sessions', (req, res) => {
  const input = parse(CreateReviewSession, req.body, res);
  if (input) res.status(201).json(store.createReviewSession(input));
});

app.get('/api/review-sessions/:id', (req, res) => {
  const session = store.getReviewSession(req.params.id);
  if (session) res.json(session);
  else res.status(404).json({ error: 'Review session not found' });
});

app.post('/api/review-sessions/:id/comments', (req, res) => {
  const input = parse(AddComment, req.body, res);
  if (!input) return;
  const comment = store.addComment(req.params.id, input);
  if (comment) res.status(201).json(comment);
  else res.status(404).json({ error: 'Review session not found' });
});

app.listen(port, '127.0.0.1');
