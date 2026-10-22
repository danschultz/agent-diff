// Reads and writes the database with node:sqlite and plain SQL, from decision
// 0022. The review server is the only process that opens it (0023). Every
// method is synchronous, so a transaction never awaits.
import { DatabaseSync } from 'node:sqlite';
import type {
  AddWorkingDirectoriesOutput,
  Session,
  WorkingDirectory,
} from '@agent-diff/shared/schemas';
import { newSessionId } from './ids.ts';

// Opens the database with the connection settings from decision 0039.
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
  // Generates session IDs. Tests pass one that collides.
  newSessionId?: () => string;
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

export class Store {
  #db: DatabaseSync;
  #newSessionId: () => string;

  constructor(databasePath: string, options: StoreOptions = {}) {
    this.#db = openDatabase(databasePath);
    this.#newSessionId = options.newSessionId ?? newSessionId;
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

  close(): void {
    this.#db.close();
  }
}
