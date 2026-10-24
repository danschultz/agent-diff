// Implements the contract from @agent-diff/shared.
import { implement, ORPCError } from '@orpc/server';
import { contract } from '@agent-diff/shared/contract';
import { StoreError, type Store } from './store.ts';
import {
  isDirectory,
  resolveWorkingDirectories,
  WorkingDirectoryError,
} from './working-directories.ts';

export interface RouterOptions {
  // The environment git runs with.
  env: NodeJS.ProcessEnv;
}

function notFound(id: string): ORPCError<'NOT_FOUND', unknown> {
  return new ORPCError('NOT_FOUND', { message: `There's no session ${id}.` });
}

function archived(id: string): ORPCError<'CONFLICT', unknown> {
  return new ORPCError('CONFLICT', {
    message: `Session ${id} is archived, so working directories can't be added to it.`,
  });
}

// Reports a WorkingDirectoryError as a bad request, with its message.
async function resolving<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof WorkingDirectoryError) {
      throw new ORPCError('BAD_REQUEST', { message: error.message });
    }
    throw error;
  }
}

// Reports a StoreError with its code and message.
function storing<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof StoreError) {
      throw new ORPCError(error.code, { message: error.message });
    }
    throw error;
  }
}

export function createRouter(store: Store, { env }: RouterOptions) {
  const os = implement(contract);
  return os.router({
    health: os.health.handler(() => ({ ok: true as const })),
    session: {
      // The paths are checked, and git run, before anything is written, so a
      // call that fails adds nothing.
      new: os.session.new.handler(async ({ input }) => {
        const workingDirectories = await resolving(
          resolveWorkingDirectories(input.workingDirectories, {
            base: input.base,
            env,
          }),
        );
        return store.createSession({
          title: input.title ?? null,
          workingDirectories,
        });
      }),
      add: os.session.add.handler(async ({ input }) => {
        const session = store.getSession(input.id);
        if (!session) throw notFound(input.id);
        if (session.archivedAt !== null) throw archived(input.id);
        const workingDirectories = await resolving(
          resolveWorkingDirectories(input.workingDirectories, {
            base: input.base,
            existing: new Set(session.workingDirectories.map((w) => w.path)),
            env,
          }),
        );
        // The session may have been archived or deleted while git ran.
        const added = store.addWorkingDirectories(input.id, workingDirectories);
        if (added === undefined) throw notFound(input.id);
        if (added === 'archived') throw archived(input.id);
        return added;
      }),
      show: os.session.show.handler(async ({ input }) => {
        const session = store.getSession(input.id);
        if (!session) throw notFound(input.id);
        const commentCounts = store.commentCounts(input.id);
        return {
          ...session,
          commentCounts,
          workingDirectories: await Promise.all(
            session.workingDirectories.map(async (workingDirectory) => ({
              ...workingDirectory,
              missing: !(await isDirectory(workingDirectory.path)),
            })),
          ),
        };
      }),
      list: os.session.list.handler(({ input }) =>
        store.listSessions({ all: input.all }),
      ),
      archive: os.session.archive.handler(({ input }) => {
        const result = store.archiveSession(input.id);
        if (!result) throw notFound(input.id);
        return result;
      }),
      delete: os.session.delete.handler(({ input }) => {
        if (!store.deleteSession(input.id)) throw notFound(input.id);
      }),
    },
    comment: {
      add: os.comment.add.handler(({ input }) =>
        storing(() => store.addComment(input.sessionId, input.text)),
      ),
      edit: os.comment.edit.handler(({ input }) =>
        storing(() => store.editComment(input.id, input.text)),
      ),
      delete: os.comment.delete.handler(({ input }) =>
        storing(() => store.deleteComment(input.id)),
      ),
      reply: os.comment.reply.handler(({ input }) =>
        storing(() => store.reply(input.id, input.status, input.text)),
      ),
      resolve: os.comment.resolve.handler(({ input }) =>
        storing(() => store.resolveComment(input.id)),
      ),
    },
    review: {
      submit: os.review.submit.handler(({ input }) =>
        storing(() => store.submitReview(input.sessionId)),
      ),
      show: os.review.show.handler(({ input }) => {
        const review = store.getReview(input.id);
        if (!review) {
          throw new ORPCError('NOT_FOUND', {
            message: `There's no review ${input.id}.`,
          });
        }
        return review;
      }),
      list: os.review.list.handler(({ input }) => {
        const reviews = store.listReviews(input.sessionId);
        if (!reviews) throw notFound(input.sessionId);
        return reviews;
      }),
    },
  });
}

export type Router = ReturnType<typeof createRouter>;
