-- migrate:up
-- Timestamps are ISO 8601 strings in UTC, such as 2026-10-22T09:30:00.000Z.
CREATE TABLE sessions (
  -- `s_` and 6 lowercase Crockford base32 characters, such as s_7kq9a1.
  id TEXT PRIMARY KEY,
  title TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- Null while the session is active. Archiving is one-way.
  archived_at TEXT
);

-- A directory under review, identified by its real path, with symlinks
-- resolved, across every session it's in. One that's left in no session is
-- deleted with the last session it was in.
CREATE TABLE working_directories (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- A working directory's membership in a session, in the order it was added.
-- The base ref is the ref name as given or chosen, not a commit, or null when
-- the working directory doesn't use git.
CREATE TABLE session_working_directories (
  session_id TEXT NOT NULL REFERENCES sessions (id)
    ON DELETE CASCADE,
  working_directory_id INTEGER NOT NULL REFERENCES working_directories (id),
  base_ref TEXT,
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (session_id, working_directory_id)
);

-- For finding the working directories left in no session.
CREATE INDEX session_working_directories_working_directory_id
ON session_working_directories (working_directory_id);

-- migrate:down
DROP TABLE session_working_directories;

DROP TABLE working_directories;

DROP TABLE sessions;
