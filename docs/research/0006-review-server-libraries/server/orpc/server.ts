import { createServer, type IncomingHttpHeaders } from 'node:http';
import { OpenAPIHandler } from '@orpc/openapi/node';
import {
  EventPublisher,
  implement,
  ORPCError,
  ValidationError,
} from '@orpc/server';
import * as z from 'zod';
import { contract } from './contract.ts';
import { checkRequest, port } from './shared/config.ts';
import type { Comment } from './shared/schemas.ts';
import { Store } from './shared/store.ts';

const store = new Store();
const published = new EventPublisher<{ comment: Comment }>();
store.onComment((c) => published.publish('comment', c));

const os = implement(contract).$context<{ headers: IncomingHttpHeaders }>();

const authorized = os.middleware(({ context, next }) => {
  const denied = checkRequest(
    context.headers.host,
    context.headers.authorization,
  );
  if (denied)
    throw new ORPCError(denied.status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN', {
      message: denied.error,
    });
  return next();
});

const router = os.use(authorized).router({
  health: os.health.handler(() => ({ ok: true })),
  events: os.events.handler(({ signal }) =>
    published.subscribe('comment', { signal }),
  ),
  reviewSessions: {
    create: os.reviewSessions.create.handler(({ input }) =>
      store.createReviewSession(input),
    ),
    get: os.reviewSessions.get.handler(({ input, errors }) => {
      const session = store.getReviewSession(input.id);
      if (!session) throw errors.NOT_FOUND();
      return session;
    }),
    addComment: os.reviewSessions.addComment.handler(({ input, errors }) => {
      const comment = store.addComment(input.params.id, input.body);
      if (!comment) throw errors.NOT_FOUND();
      return comment;
    }),
  },
});

const handler = new OpenAPIHandler(router, {
  clientInterceptors: [
    async ({ next }) => {
      try {
        return await next();
      } catch (error) {
        if (
          error instanceof ORPCError &&
          error.code === 'BAD_REQUEST' &&
          error.cause instanceof ValidationError
        ) {
          throw new ORPCError('BAD_REQUEST', {
            message: z.prettifyError(
              new z.ZodError(error.cause.issues as z.core.$ZodIssue[]),
            ),
          });
        }
        throw error;
      }
    },
  ],
});

createServer(async (req, res) => {
  const { matched } = await handler.handle(req, res, {
    prefix: '/api',
    context: { headers: req.headers },
  });
  if (!matched) res.writeHead(404).end();
}).listen(port, '127.0.0.1');
