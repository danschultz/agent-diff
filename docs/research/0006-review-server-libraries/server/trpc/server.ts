import { initTRPC, TRPCError } from '@trpc/server';
import { createHTTPServer } from '@trpc/server/adapters/standalone';
import * as z from 'zod';
import { checkRequest, port } from './shared/config.ts';
import {
  AddComment,
  CreateReviewSession,
  type Comment,
} from './shared/schemas.ts';
import { Store } from './shared/store.ts';

const store = new Store();

const t = initTRPC.create({
  errorFormatter: ({ shape, error }) => ({
    ...shape,
    message:
      error.cause instanceof z.ZodError
        ? z.prettifyError(error.cause)
        : shape.message,
  }),
});

const notFound = () =>
  new TRPCError({ code: 'NOT_FOUND', message: 'Review session not found' });

export const router = t.router({
  health: t.procedure.query(() => ({ ok: true })),
  events: t.procedure.subscription(async function* ({ signal }) {
    const queue: Comment[] = [];
    let wake = () => {};
    const stop = store.onComment((c) => {
      queue.push(c);
      wake();
    });
    signal?.addEventListener('abort', () => wake());
    try {
      while (!signal?.aborted) {
        const comment = queue.shift();
        if (comment) yield comment;
        else await new Promise<void>((resolve) => (wake = resolve));
      }
    } finally {
      stop();
    }
  }),
  reviewSessions: {
    create: t.procedure
      .input(CreateReviewSession)
      .mutation(({ input }) => store.createReviewSession(input)),
    get: t.procedure
      .input(z.object({ id: z.string() }))
      .query(
        ({ input }) =>
          store.getReviewSession(input.id) ?? Promise.reject(notFound()),
      ),
    addComment: t.procedure
      .input(z.object({ id: z.string(), comment: AddComment }))
      .mutation(
        ({ input }) =>
          store.addComment(input.id, input.comment) ??
          Promise.reject(notFound()),
      ),
  },
});

export type Router = typeof router;

if (import.meta.main) {
  createHTTPServer({
    router,
    basePath: '/api/',
    createContext: ({ req }) => {
      const denied = checkRequest(req.headers.host, req.headers.authorization);
      if (denied)
        throw new TRPCError({
          code: denied.status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN',
          message: denied.error,
        });
      return {};
    },
  }).listen(port, '127.0.0.1');
}
