// Reads and writes the database with node:sqlite and plain SQL, from decision
// 0022. The review server is the only process that opens it (0023). Every
// method is synchronous, so a transaction never awaits.
import { DatabaseSync } from 'node:sqlite';
import type {
  AddWorkingDirectoriesOutput,
  Comment,
  CommentCounts,
  CommentStatus,
  DraftComment,
  ReplyStatus,
  Review,
  ReviewDetails,
  Session,
  SessionReviews,
  WorkingDirectory,
} from '@agent-diff/shared/schemas';
import { newCommentId, newReviewId, newSessionId } from './ids.ts';
import { reviewMessage } from './review-message.ts';

// Opens the database with the connection settings from decision 0040.
export function openDatabase(databasePath: string): DatabaseSync {
  const db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
  `);
  return db;
}

export interface StoreOptions {
  // Generate session, comment, and review IDs. Tests pass ones that collide.
  newSessionId?: () => string;
  newCommentId?: () => string;
  newReviewId?: () => string;
}

// Why a change to a session's comments or reviews was refused, with a message
// naming what was asked for. The router reports it with the same code.
export class StoreError extends Error {
  readonly code: 'NOT_FOUND' | 'CONFLICT';

  constructor(code: 'NOT_FOUND' | 'CONFLICT', message: string) {
    super(message);
    this.code = code;
  }
}

function noSession(id: string): StoreError {
  return new StoreError('NOT_FOUND', `There's no session ${id}.`);
}

// Agents can't see comments in the draft review, so asking for one as a
// submitted comment fails as if it didn't exist.
function noComment(id: string): StoreError {
  return new StoreError('NOT_FOUND', `There's no comment ${id}.`);
}

// An archived session is read-only (0043).
function archived(sessionId: string, refused: string): StoreError {
  return new StoreError(
    'CONFLICT',
    `Session ${sessionId} is archived, so ${refused}.`,
  );
}

export interface NewSession {
  title: string | null;
  workingDirectories: WorkingDirectory[];
}

interface SessionRow {
  id: string;
  title: string | null;
  created_at: string;
  archived_at: string | null;
}

interface MembershipRow {
  session_id: string;
  path: string;
  base_ref: string | null;
}

interface CommentRow {
  id: string;
  kind: 'overall';
  text: string;
  status: CommentStatus | null;
  created_at: string;
  // The review's public ID, or null while it's the draft review.
  review_id: string | null;
  session_id: string;
  archived_at: string | null;
}

interface ReplyRow {
  comment_id: string;
  status: ReplyStatus;
  text: string;
  created_at: string;
}

interface ReviewRow {
  id: number;
  public_id: string;
  session_id: string;
  submitted_at: string;
}

// The columns every comment query selects, from comments AS c joined to its
// review AS r and session AS s.
const commentColumns = `c.id, c.kind, c.text, c.status, c.created_at,
  r.public_id AS review_id, r.session_id, s.archived_at`;

const commentJoins = `comments AS c
  JOIN reviews AS r ON r.id = c.review_id
  JOIN sessions AS s ON s.id = r.session_id`;

export class Store {
  #db: DatabaseSync;
  #newSessionId: () => string;
  #newCommentId: () => string;
  #newReviewId: () => string;

  constructor(databasePath: string, options: StoreOptions = {}) {
    this.#db = openDatabase(databasePath);
    this.#newSessionId = options.newSessionId ?? newSessionId;
    this.#newCommentId = options.newCommentId ?? newCommentId;
    this.#newReviewId = options.newReviewId ?? newReviewId;
  }

  // Runs fn in a transaction, which commits when it returns and rolls back
  // when it throws.
  #transaction<T>(fn: () => T): T {
    this.#db.exec('BEGIN');
    try {
      const result = fn();
      this.#db.exec('COMMIT');
      return result;
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  // The session's working directories, in the order they were added, keyed
  // by session ID. One query for every session, rather than one per session.
  #workingDirectories(sessionIds: string[]): Map<string, WorkingDirectory[]> {
    const bySession = new Map<string, WorkingDirectory[]>(
      sessionIds.map((id) => [id, []]),
    );
    if (sessionIds.length === 0) return bySession;
    const rows = this.#db
      .prepare(
        `SELECT m.session_id, w.path, m.base_ref
        FROM session_working_directories AS m
        JOIN working_directories AS w ON w.id = m.working_directory_id
        WHERE m.session_id IN (SELECT value FROM json_each(?))
        ORDER BY m.rowid`,
      )
      .all(JSON.stringify(sessionIds)) as unknown as MembershipRow[];
    for (const row of rows) {
      bySession
        .get(row.session_id)!
        .push({ path: row.path, baseRef: row.base_ref });
    }
    return bySession;
  }

  #toSession(row: SessionRow, workingDirectories: WorkingDirectory[]): Session {
    return {
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      archivedAt: row.archived_at,
      workingDirectories,
    };
  }

  #sessionRow(id: string): SessionRow | undefined {
    return this.#db
      .prepare(
        'SELECT id, title, created_at, archived_at FROM sessions WHERE id = ?',
      )
      .get(id) as unknown as SessionRow | undefined;
  }

  // Adds the working directory to the session, unless it's in it already.
  // Returns its membership, and whether it was there already, in which case
  // it keeps its base ref.
  #addWorkingDirectory(
    sessionId: string,
    { path, baseRef }: WorkingDirectory,
  ): AddWorkingDirectoriesOutput['workingDirectories'][number] {
    this.#db
      .prepare(
        'INSERT INTO working_directories (path) VALUES (?) ON CONFLICT (path) DO NOTHING',
      )
      .run(path);
    const { changes } = this.#db
      .prepare(
        `INSERT INTO session_working_directories (session_id, working_directory_id, base_ref)
        SELECT ?, id, ? FROM working_directories WHERE path = ?
        ON CONFLICT DO NOTHING`,
      )
      .run(sessionId, baseRef, path);
    if (changes > 0) return { path, baseRef, alreadyInSession: false };
    const row = this.#db
      .prepare(
        `SELECT m.base_ref FROM session_working_directories AS m
        JOIN working_directories AS w ON w.id = m.working_directory_id
        WHERE m.session_id = ? AND w.path = ?`,
      )
      .get(sessionId, path) as unknown as { base_ref: string | null };
    return { path, baseRef: row.base_ref, alreadyInSession: true };
  }

  // Creates a session with a new ID, generated again while it's taken.
  createSession({ title, workingDirectories }: NewSession): Session {
    return this.#transaction(() => {
      let id: string;
      do id = this.#newSessionId();
      while (this.#sessionRow(id));
      this.#db
        .prepare('INSERT INTO sessions (id, title) VALUES (?, ?)')
        .run(id, title);
      for (const workingDirectory of workingDirectories) {
        this.#addWorkingDirectory(id, workingDirectory);
      }
      return this.getSession(id)!;
    });
  }

  getSession(id: string): Session | undefined {
    const row = this.#sessionRow(id);
    if (!row) return undefined;
    return this.#toSession(row, this.#workingDirectories([id]).get(id)!);
  }

  // Adds working directories to an active session, keeping the ones already
  // in it as they are. Returns undefined when there's no such session, and
  // 'archived' when it's archived, adding nothing.
  addWorkingDirectories(
    id: string,
    workingDirectories: WorkingDirectory[],
  ): AddWorkingDirectoriesOutput | 'archived' | undefined {
    return this.#transaction(() => {
      const row = this.#sessionRow(id);
      if (!row) return undefined;
      if (row.archived_at !== null) return 'archived';
      return {
        workingDirectories: workingDirectories.map((workingDirectory) =>
          this.#addWorkingDirectory(id, workingDirectory),
        ),
      };
    });
  }

  // Active sessions, or every session with all, newest first.
  listSessions({ all }: { all: boolean }): Session[] {
    const rows = this.#db
      .prepare(
        `SELECT id, title, created_at, archived_at FROM sessions
        WHERE ? OR archived_at IS NULL
        ORDER BY created_at DESC, rowid DESC`,
      )
      .all(all ? 1 : 0) as unknown as SessionRow[];
    const workingDirectories = this.#workingDirectories(
      rows.map((row) => row.id),
    );
    return rows.map((row) =>
      this.#toSession(row, workingDirectories.get(row.id)!),
    );
  }

  // Archives a session, or returns when it was archived if it already was.
  // Returns undefined when there's no such session.
  archiveSession(
    id: string,
  ): { archivedAt: string; alreadyArchived: boolean } | undefined {
    return this.#transaction(() => {
      const row = this.#sessionRow(id);
      if (!row) return undefined;
      if (row.archived_at !== null) {
        return { archivedAt: row.archived_at, alreadyArchived: true };
      }
      const archived = this.#db
        .prepare(
          `UPDATE sessions SET archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = ? RETURNING archived_at`,
        )
        .get(id) as unknown as { archived_at: string };
      return { archivedAt: archived.archived_at, alreadyArchived: false };
    });
  }

  // Deletes a session, its memberships through their foreign key, and the
  // working directories left in no session. Returns whether it existed.
  deleteSession(id: string): boolean {
    return this.#transaction(() => {
      const { changes } = this.#db
        .prepare('DELETE FROM sessions WHERE id = ?')
        .run(id);
      if (changes === 0) return false;
      this.#db
        .prepare(
          `DELETE FROM working_directories WHERE NOT EXISTS (
            SELECT 1 FROM session_working_directories AS m
            WHERE m.working_directory_id = working_directories.id
          )`,
        )
        .run();
      return true;
    });
  }

  // The session, when it's active. Fails when there's no such session, or
  // when it's archived, saying what was refused.
  #activeSession(id: string, refused: string): SessionRow {
    const row = this.#sessionRow(id);
    if (!row) throw noSession(id);
    if (row.archived_at !== null) throw archived(id, refused);
    return row;
  }

  #commentRow(id: string): CommentRow | undefined {
    return this.#db
      .prepare(`SELECT ${commentColumns} FROM ${commentJoins} WHERE c.id = ?`)
      .get(id) as unknown as CommentRow | undefined;
  }

  // A comment in the draft review of an active session. Fails when there's
  // no such comment, when its session is archived, or when it's been
  // submitted, saying what was refused.
  #draftCommentRow(id: string, verb: 'edited' | 'deleted'): CommentRow {
    const row = this.#commentRow(id);
    if (!row) throw noComment(id);
    if (row.archived_at !== null) {
      throw archived(row.session_id, "its draft review can't be changed");
    }
    if (row.review_id !== null) {
      throw new StoreError(
        'CONFLICT',
        `Comment ${id} has been submitted, so it can't be ${verb}.`,
      );
    }
    return row;
  }

  // A submitted comment in an active session. Fails when there's no such
  // comment, or it's in the draft review, and when its session is archived.
  #submittedCommentRow(id: string, refused: string): CommentRow {
    const row = this.#commentRow(id);
    if (!row || row.review_id === null) throw noComment(id);
    if (row.archived_at !== null) throw archived(row.session_id, refused);
    return row;
  }

  #toDraftComment(row: CommentRow): DraftComment {
    return {
      id: row.id,
      kind: row.kind,
      text: row.text,
      createdAt: row.created_at,
    };
  }

  #toReview(row: ReviewRow): Review {
    return {
      id: row.public_id,
      sessionId: row.session_id,
      submittedAt: row.submitted_at,
      message: reviewMessage(row.public_id, row.session_id),
    };
  }

  // Submitted comments with their agents' replies, oldest first: a session's,
  // or those submitted in one review. Two queries, however many comments
  // there are.
  #submittedComments(
    where: 'r.session_id = ?' | 'r.id = ?',
    value: string | number,
  ): Comment[] {
    const rows = this.#db
      .prepare(
        `SELECT ${commentColumns} FROM ${commentJoins}
        WHERE r.submitted_at IS NOT NULL AND ${where}
        ORDER BY c.rowid`,
      )
      .all(value) as unknown as CommentRow[];
    const replies = this.#db
      .prepare(
        `SELECT p.comment_id, p.status, p.text, p.created_at
        FROM replies AS p
        JOIN comments AS c ON c.id = p.comment_id
        JOIN reviews AS r ON r.id = c.review_id
        WHERE r.submitted_at IS NOT NULL AND ${where} AND p.author = 'agent'
        ORDER BY p.id`,
      )
      .all(value) as unknown as ReplyRow[];
    const comments = new Map<string, Comment>(
      rows.map((row) => [
        row.id,
        {
          ...this.#toDraftComment(row),
          reviewId: row.review_id!,
          status: row.status!,
          replies: [],
        },
      ]),
    );
    for (const reply of replies) {
      comments.get(reply.comment_id)!.replies.push({
        author: 'agent',
        status: reply.status,
        text: reply.text,
        createdAt: reply.created_at,
      });
    }
    return [...comments.values()];
  }

  // Adds an overall comment to the session's draft review, starting one when
  // there's none.
  addComment(sessionId: string, text: string): DraftComment {
    return this.#transaction(() => {
      this.#activeSession(sessionId, "its draft review can't be changed");
      let draft = this.#db
        .prepare(
          'SELECT id FROM reviews WHERE session_id = ? AND submitted_at IS NULL',
        )
        .get(sessionId) as unknown as { id: number } | undefined;
      draft ??= this.#db
        .prepare('INSERT INTO reviews (session_id) VALUES (?) RETURNING id')
        .get(sessionId) as unknown as { id: number };
      let id: string;
      do id = this.#newCommentId();
      while (this.#commentRow(id));
      this.#db
        .prepare(
          `INSERT INTO comments (id, review_id, kind, text)
          VALUES (?, ?, 'overall', ?)`,
        )
        .run(id, draft.id, text);
      return this.#toDraftComment(this.#commentRow(id)!);
    });
  }

  editComment(id: string, text: string): DraftComment {
    return this.#transaction(() => {
      this.#draftCommentRow(id, 'edited');
      this.#db
        .prepare('UPDATE comments SET text = ? WHERE id = ?')
        .run(text, id);
      return this.#toDraftComment(this.#commentRow(id)!);
    });
  }

  deleteComment(id: string): void {
    this.#transaction(() => {
      this.#draftCommentRow(id, 'deleted');
      this.#db.prepare('DELETE FROM comments WHERE id = ?').run(id);
    });
  }

  // Turns the session's draft review into a review with a new ID, generated
  // again while it's taken, and sets its comments to open. Fails when the
  // draft review is empty.
  submitReview(sessionId: string): Review {
    return this.#transaction(() => {
      this.#activeSession(sessionId, "its draft review can't be submitted");
      const draft = this.#db
        .prepare(
          `SELECT r.id FROM reviews AS r
          WHERE r.session_id = ? AND r.submitted_at IS NULL
          AND EXISTS (SELECT 1 FROM comments AS c WHERE c.review_id = r.id)`,
        )
        .get(sessionId) as unknown as { id: number } | undefined;
      if (!draft) {
        throw new StoreError(
          'CONFLICT',
          `The draft review in session ${sessionId} is empty, so it can't be submitted.`,
        );
      }
      let publicId: string;
      do publicId = this.#newReviewId();
      while (
        this.#db
          .prepare('SELECT 1 FROM reviews WHERE public_id = ?')
          .get(publicId)
      );
      const review = this.#db
        .prepare(
          `UPDATE reviews
          SET public_id = ?, submitted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = ?
          RETURNING id, public_id, session_id, submitted_at`,
        )
        .get(publicId, draft.id) as unknown as ReviewRow;
      this.#db
        .prepare("UPDATE comments SET status = 'open' WHERE review_id = ?")
        .run(draft.id);
      return this.#toReview(review);
    });
  }

  // The session's submitted comments with their threads, its draft review,
  // and its submitted reviews, newest first, in a fixed number of queries.
  // Undefined when there's no such session.
  listReviews(sessionId: string): SessionReviews | undefined {
    if (!this.#sessionRow(sessionId)) return undefined;
    const drafts = this.#db
      .prepare(
        `SELECT ${commentColumns} FROM ${commentJoins}
        WHERE r.session_id = ? AND r.submitted_at IS NULL
        ORDER BY c.rowid`,
      )
      .all(sessionId) as unknown as CommentRow[];
    const reviews = this.#db
      .prepare(
        `SELECT id, public_id, session_id, submitted_at FROM reviews
        WHERE session_id = ? AND submitted_at IS NOT NULL
        ORDER BY submitted_at DESC, id DESC`,
      )
      .all(sessionId) as unknown as ReviewRow[];
    return {
      comments: this.#submittedComments('r.session_id = ?', sessionId),
      draftReview: { comments: drafts.map((row) => this.#toDraftComment(row)) },
      reviews: reviews.map((row) => this.#toReview(row)),
    };
  }

  // A submitted review and the comments submitted in it. Undefined when
  // there's no such review. A draft review has no public ID, so it's never
  // found.
  getReview(id: string): ReviewDetails | undefined {
    const row = this.#db
      .prepare(
        `SELECT id, public_id, session_id, submitted_at FROM reviews
        WHERE public_id = ?`,
      )
      .get(id) as unknown as ReviewRow | undefined;
    if (!row) return undefined;
    return {
      id: row.public_id,
      sessionId: row.session_id,
      submittedAt: row.submitted_at,
      comments: this.#submittedComments('r.id = ?', row.id),
    };
  }

  // Adds an agent's reply to a submitted comment, with any status, and sets
  // the comment's status from it.
  reply(
    id: string,
    status: ReplyStatus,
    text: string,
  ): { id: string; status: CommentStatus } {
    return this.#transaction(() => {
      this.#submittedCommentRow(id, "its comments can't be replied to");
      this.#db
        .prepare(
          `INSERT INTO replies (comment_id, author, status, text)
          VALUES (?, 'agent', ?, ?)`,
        )
        .run(id, status, text);
      this.#db
        .prepare('UPDATE comments SET status = ? WHERE id = ?')
        .run(status, id);
      return { id, status };
    });
  }

  // Resolves a submitted comment, whatever its status.
  resolveComment(id: string): void {
    this.#transaction(() => {
      this.#submittedCommentRow(id, "its comments can't be resolved");
      this.#db
        .prepare("UPDATE comments SET status = 'resolved' WHERE id = ?")
        .run(id);
    });
  }

  // How many of the session's submitted comments have each status.
  commentCounts(sessionId: string): CommentCounts {
    const counts: CommentCounts = {
      open: 0,
      addressed: 0,
      needs_input: 0,
      resolved: 0,
    };
    const rows = this.#db
      .prepare(
        `SELECT c.status, count(*) AS count
        FROM comments AS c JOIN reviews AS r ON r.id = c.review_id
        WHERE r.session_id = ? AND r.submitted_at IS NOT NULL
        GROUP BY c.status`,
      )
      .all(sessionId) as unknown as { status: CommentStatus; count: number }[];
    for (const row of rows) counts[row.status] = row.count;
    return counts;
  }

  close(): void {
    this.#db.close();
  }
}
