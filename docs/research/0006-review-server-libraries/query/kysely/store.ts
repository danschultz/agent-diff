import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { Kysely, SqliteDialect } from 'kysely';
import type {
  AddComment,
  Comment,
  CreateReviewSession,
  ReviewSession,
} from './types.ts';

interface Database {
  review_sessions: { id: string; title: string | null; started_at: string };
  review_session_working_directories: {
    review_session_id: string;
    path: string;
  };
  comments: {
    id: string;
    review_session_id: string;
    path: string;
    start_line: number;
    end_line: number;
    body: string;
    created_at: string;
  };
}

// Kysely's SqliteDialect expects better-sqlite3's interface. node:sqlite is close enough with this adapter.
function adapt(db: DatabaseSync) {
  return {
    close: () => db.close(),
    prepare(sql: string) {
      const statement = db.prepare(sql);
      const args = (p: readonly unknown[]) => p as SQLInputValue[];
      return {
        reader: statement.columns().length > 0,
        all: (p: readonly unknown[]) => statement.all(...args(p)),
        run: (p: readonly unknown[]) => statement.run(...args(p)),
        iterate: (p: readonly unknown[]) => statement.iterate(...args(p)),
      };
    },
  };
}

export class Store {
  private readonly db: Kysely<Database>;

  private constructor(db: Kysely<Database>) {
    this.db = db;
  }

  static open(file: string): Store {
    const sqlite = new DatabaseSync(file);
    sqlite.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
    return new Store(
      new Kysely<Database>({
        dialect: new SqliteDialect({ database: adapt(sqlite) }),
      }),
    );
  }

  async createReviewSession(
    input: CreateReviewSession,
  ): Promise<ReviewSession> {
    const id = randomUUID();
    await this.db.transaction().execute(async (tx) => {
      await tx
        .insertInto('review_sessions')
        .values({
          id,
          title: input.title ?? null,
          started_at: new Date().toISOString(),
        })
        .execute();
      await tx
        .insertInto('review_session_working_directories')
        .values(
          input.workingDirectories.map((path) => ({
            review_session_id: id,
            path,
          })),
        )
        .execute();
    });
    return (await this.getReviewSession(id))!;
  }

  async getReviewSession(id: string): Promise<ReviewSession | undefined> {
    const row = await this.db
      .selectFrom('review_sessions')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) return undefined;
    const dirs = await this.db
      .selectFrom('review_session_working_directories')
      .select('path')
      .where('review_session_id', '=', id)
      .orderBy('path')
      .execute();
    const comments = await this.db
      .selectFrom('comments')
      .select([
        'id',
        'review_session_id as reviewSessionId',
        'path',
        'start_line as startLine',
        'end_line as endLine',
        'body',
        'created_at as createdAt',
      ])
      .where('review_session_id', '=', id)
      .orderBy('created_at')
      .execute();
    return {
      id: row.id,
      title: row.title,
      workingDirectories: dirs.map((d) => d.path),
      startedAt: row.started_at,
      comments,
    };
  }

  async addComment(
    reviewSessionId: string,
    input: AddComment,
  ): Promise<Comment | undefined> {
    const exists = await this.db
      .selectFrom('review_sessions')
      .select('id')
      .where('id', '=', reviewSessionId)
      .executeTakeFirst();
    if (!exists) return undefined;
    const comment: Comment = {
      id: randomUUID(),
      reviewSessionId,
      ...input,
      createdAt: new Date().toISOString(),
    };
    await this.db
      .insertInto('comments')
      .values({
        id: comment.id,
        review_session_id: reviewSessionId,
        path: comment.path,
        start_line: comment.startLine,
        end_line: comment.endLine,
        body: comment.body,
        created_at: comment.createdAt,
      })
      .execute();
    return comment;
  }
}
