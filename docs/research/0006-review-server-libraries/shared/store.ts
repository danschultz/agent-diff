// SQLite storage shared by every server example. Uses node:sqlite so no
// example pays for a driver in its install size.
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type {
  AddComment,
  Comment,
  CreateReviewSession,
  ReviewSession,
} from './schemas.ts';

type Listener = (comment: Comment) => void;

export class Store {
  private readonly db: DatabaseSync;
  private readonly listeners = new Set<Listener>();

  constructor(file = ':memory:') {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      pragma journal_mode = wal;
      pragma foreign_keys = on;
      create table if not exists review_sessions (
        id text primary key, title text, started_at text not null);
      create table if not exists review_session_working_directories (
        review_session_id text not null references review_sessions(id),
        path text not null, primary key (review_session_id, path));
      create table if not exists comments (
        id text primary key,
        review_session_id text not null references review_sessions(id),
        path text not null, start_line integer not null, end_line integer not null,
        body text not null, created_at text not null);
    `);
  }

  createReviewSession(input: CreateReviewSession): ReviewSession {
    const id = randomUUID();
    const startedAt = new Date().toISOString();
    this.db.exec('begin');
    try {
      this.db
        .prepare(
          'insert into review_sessions (id, title, started_at) values (?, ?, ?)',
        )
        .run(id, input.title ?? null, startedAt);
      const add = this.db.prepare(
        'insert into review_session_working_directories (review_session_id, path) values (?, ?)',
      );
      for (const dir of input.workingDirectories) add.run(id, dir);
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
        `select id, review_session_id as reviewSessionId, path, start_line as startLine,
         end_line as endLine, body, created_at as createdAt
         from comments where review_session_id = ? order by created_at`,
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
    if (!this.getReviewSession(reviewSessionId)) return undefined;
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
    for (const listener of this.listeners) listener(comment);
    return comment;
  }

  /** Calls the listener for each comment added, until the returned function is called. */
  onComment(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
