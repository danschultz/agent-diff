-- migrate:up
-- A session's reviews, from decisions 0036 and 0043. The draft review is the
-- one without a submitted_at, and a session has at most one. Submitting it
-- gives it its public ID.
CREATE TABLE reviews (
  id INTEGER PRIMARY KEY,
  -- `r_` and 6 lowercase Crockford base32 characters, such as r_4m2x9p, or
  -- null while it's the draft review.
  public_id TEXT UNIQUE,
  session_id TEXT NOT NULL REFERENCES sessions (id)
    ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  submitted_at TEXT,
  CHECK ((public_id IS NULL) = (submitted_at IS NULL))
);

CREATE INDEX reviews_session_id ON reviews (session_id);

-- At most one draft review per session.
CREATE UNIQUE INDEX reviews_draft_review ON reviews (session_id)
WHERE submitted_at IS NULL;

-- A comment, written in a review, the draft review until it's submitted.
CREATE TABLE comments (
  -- `c_` and 6 lowercase Crockford base32 characters, such as c_8f3k2a.
  id TEXT PRIMARY KEY,
  review_id INTEGER NOT NULL REFERENCES reviews (id)
    ON DELETE CASCADE,
  -- Only overall comments for now. Line comments will add their anchors.
  kind TEXT NOT NULL CHECK (kind IN ('overall')),
  text TEXT NOT NULL,
  -- Null while the comment is in the draft review.
  status TEXT CHECK (
    status IN ('open', 'addressed', 'needs_input', 'resolved')
  ),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX comments_review_id ON comments (review_id);

-- A reply in a comment's thread, in the order it was written. An agent's
-- reply sets the comment's status and isn't in a review. A reviewer's reply
-- is written in a review, the draft review until it's submitted, and has no
-- status of its own.
CREATE TABLE replies (
  id INTEGER PRIMARY KEY,
  comment_id TEXT NOT NULL REFERENCES comments (id)
    ON DELETE CASCADE,
  author TEXT NOT NULL CHECK (author IN ('agent', 'reviewer')),
  review_id INTEGER REFERENCES reviews (id)
    ON DELETE CASCADE,
  status TEXT CHECK (status IN ('addressed', 'needs_input')),
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((author = 'reviewer') = (review_id IS NOT NULL)),
  CHECK ((author = 'agent') = (status IS NOT NULL))
);

CREATE INDEX replies_comment_id ON replies (comment_id);

CREATE INDEX replies_review_id ON replies (review_id);

-- migrate:down
DROP TABLE replies;

DROP TABLE comments;

DROP TABLE reviews;
