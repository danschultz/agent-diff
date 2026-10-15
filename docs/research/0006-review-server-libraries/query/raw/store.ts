import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type {
  AddComment,
  Comment,
  CreateReviewSession,
  ReviewSession,
} from './types.ts';

export class Store {
  private readonly db: DatabaseSync;

  private constructor(db: DatabaseSync) {
    this.db = db;
  }

  static open(file: string): Store {
    const db = new DatabaseSync(file);
    db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
    return new Store(db);
  }

  createReviewSession(input: CreateReviewSession): ReviewSession {
    const id = randomUUID();
    this.db.exec('begin');
    try {
      this.db
        .prepare(
          'insert into review_sessions (id, title, started_at) values (?, ?, ?)',
        )
        .run(id, input.title ?? null, new Date().toISOString());
      const add = this.db.prepare(
        'insert into review_session_working_directories (review_session_id, path) values (?, ?)',
      );
      for (const path of input.workingDirectories) add.run(id, path);
      this.db.exec('commit');
    } catch (error) {
      this.db.exec('rollback');
      throw error;
    }
    return this.getReviewSession(id)!;
  }

  getReviewSession(id: string): ReviewSession | undefined {
    const row = this.db
      .prepare('select id, title, started_at from review_sessions where id = ?')
      .get(id) as
      { id: string; title: string | null; started_at: string } | undefined;
    if (!row) return undefined;
    const dirs = this.db
      .prepare(
        'select path from review_session_working_directories where review_session_id = ? order by path',
      )
      .all(id) as { path: string }[];
    const comments = this.db
      .prepare(
        `select id, review_session_id as reviewSessionId, path, start_line as startLine, end_line as endLine,
         body, created_at as createdAt from comments where review_session_id = ? order by created_at`,
      )
      .all(id) as Comment[];
    return {
      id: row.id,
      title: row.title,
      workingDirectories: dirs.map((d) => d.path),
      startedAt: row.started_at,
      comments: comments.map((c) => ({ ...c })),
    };
  }

  addComment(reviewSessionId: string, input: AddComment): Comment | undefined {
    const exists = this.db
      .prepare('select 1 from review_sessions where id = ?')
      .get(reviewSessionId);
    if (!exists) return undefined;
    const comment: Comment = {
      id: randomUUID(),
      reviewSessionId,
      ...input,
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        `insert into comments (id, review_session_id, path, start_line, end_line, body, created_at)
         values (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        comment.id,
        reviewSessionId,
        comment.path,
        comment.startLine,
        comment.endLine,
        comment.body,
        comment.createdAt,
      );
    return comment;
  }
}
