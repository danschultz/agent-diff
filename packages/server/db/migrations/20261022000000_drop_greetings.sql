-- migrate:up
-- The hello world scaffolding's table, which sessions replace.
DROP TABLE greetings;

-- migrate:down
CREATE TABLE greetings (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
