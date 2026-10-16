-- migrate:up
-- Placeholder for the hello world scaffolding. A later migration drops it.
CREATE TABLE greetings (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- migrate:down
DROP TABLE greetings;
