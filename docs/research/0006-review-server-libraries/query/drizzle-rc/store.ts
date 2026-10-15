import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { defineRelations, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-sqlite';
import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';
import type {
  AddComment,
  Comment,
  CreateReviewSession,
  ReviewSession,
} from './types.ts';

const reviewSessions = sqliteTable('review_sessions', {
  id: text().primaryKey(),
  title: text(),
  startedAt: text('started_at').notNull(),
});

const workingDirectories = sqliteTable(
  'review_session_working_directories',
  {
    reviewSessionId: text('review_session_id')
      .notNull()
      .references(() => reviewSessions.id),
    path: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.reviewSessionId, t.path] })],
);

const comments = sqliteTable('comments', {
  id: text().primaryKey(),
  reviewSessionId: text('review_session_id')
    .notNull()
    .references(() => reviewSessions.id),
  path: text().notNull(),
  startLine: integer('start_line').notNull(),
  endLine: integer('end_line').notNull(),
  body: text().notNull(),
  createdAt: text('created_at').notNull(),
});

const schema = { reviewSessions, workingDirectories, comments };
const relations = defineRelations(schema, (r) => ({
  reviewSessions: {
    workingDirectories: r.many.workingDirectories({
      from: r.reviewSessions.id,
      to: r.workingDirectories.reviewSessionId,
    }),
    comments: r.many.comments({
      from: r.reviewSessions.id,
      to: r.comments.reviewSessionId,
    }),
  },
}));

const open = (client: DatabaseSync) => drizzle({ client, relations });

export class Store {
  private readonly db: ReturnType<typeof open>;

  private constructor(db: ReturnType<typeof open>) {
    this.db = db;
  }

  static open(file: string): Store {
    const client = new DatabaseSync(file);
    client.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
    return new Store(open(client));
  }

  createReviewSession(input: CreateReviewSession): ReviewSession {
    const id = randomUUID();
    this.db.transaction((tx) => {
      tx.insert(reviewSessions)
        .values({
          id,
          title: input.title ?? null,
          startedAt: new Date().toISOString(),
        })
        .run();
      tx.insert(workingDirectories)
        .values(
          input.workingDirectories.map((path) => ({
            reviewSessionId: id,
            path,
          })),
        )
        .run();
    });
    return this.getReviewSession(id)!;
  }

  getReviewSession(id: string): ReviewSession | undefined {
    const row = this.db.query.reviewSessions
      .findFirst({
        where: { id },
        with: {
          workingDirectories: {
            columns: { path: true },
            orderBy: { path: 'asc' },
          },
          comments: { orderBy: { createdAt: 'asc' } },
        },
      })
      .sync();
    return (
      row && {
        ...row,
        workingDirectories: row.workingDirectories.map((d) => d.path),
      }
    );
  }

  addComment(reviewSessionId: string, input: AddComment): Comment | undefined {
    const exists = this.db
      .select({ id: reviewSessions.id })
      .from(reviewSessions)
      .where(eq(reviewSessions.id, reviewSessionId))
      .get();
    if (!exists) return undefined;
    const comment: Comment = {
      id: randomUUID(),
      reviewSessionId,
      ...input,
      createdAt: new Date().toISOString(),
    };
    this.db.insert(comments).values(comment).run();
    return comment;
  }
}
