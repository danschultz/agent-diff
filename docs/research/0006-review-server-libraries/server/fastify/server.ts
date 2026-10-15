import Fastify from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
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
const app = Fastify().withTypeProvider<ZodTypeProvider>();
app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

app.setErrorHandler((error, _req, reply) => {
  if (hasZodFastifySchemaValidationErrors(error))
    return reply.code(400).send({ error: error.message });
  throw error;
});

app.addHook('onRequest', async (req, reply) => {
  const denied = checkRequest(req.headers.host, req.headers.authorization);
  if (denied) return reply.code(denied.status).send({ error: denied.error });
});

app.get('/api/health', () => ({ ok: true }));

app.get('/api/events', (req, reply) => {
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
  });
  reply.raw.write(': connected\n\n');
  const stop = store.onComment((c) =>
    reply.raw.write(`event: comment-added\ndata: ${JSON.stringify(c)}\n\n`),
  );
  req.raw.on('close', stop);
  return reply.hijack();
});

app.post(
  '/api/review-sessions',
  { schema: { body: CreateReviewSession, response: { 201: ReviewSession } } },
  (req, reply) => {
    reply.code(201).send(store.createReviewSession(req.body));
  },
);

app.get(
  '/api/review-sessions/:id',
  {
    schema: {
      params: z.object({ id: z.string() }),
      response: { 200: ReviewSession, 404: ErrorBody },
    },
  },
  (req, reply) => {
    const session = store.getReviewSession(req.params.id);
    if (session) reply.send(session);
    else reply.code(404).send({ error: 'Review session not found' });
  },
);

app.post(
  '/api/review-sessions/:id/comments',
  {
    schema: {
      params: z.object({ id: z.string() }),
      body: AddComment,
      response: { 201: Comment, 404: ErrorBody },
    },
  },
  (req, reply) => {
    const comment = store.addComment(req.params.id, req.body);
    if (comment) reply.code(201).send(comment);
    else reply.code(404).send({ error: 'Review session not found' });
  },
);

await app.listen({ port, host: '127.0.0.1' });
