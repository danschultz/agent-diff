CREATE TABLE review_sessions (
  id TEXT PRIMARY KEY,
  title TEXT,
  started_at TEXT NOT NULL
);
CREATE TABLE review_session_working_directories (
  review_session_id TEXT NOT NULL REFERENCES review_sessions (id),
  path TEXT NOT NULL,
  PRIMARY KEY (review_session_id, path)
);
CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  review_session_id TEXT NOT NULL REFERENCES review_sessions (id),
  path TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
