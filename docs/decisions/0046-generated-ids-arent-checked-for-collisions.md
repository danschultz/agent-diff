# 0046: Generated IDs aren't checked for collisions

- Status: Accepted
- Date: 2026-10-25

## Problem

[0040](0040-sessions-have-short-ids-and-cover-working-directories-by-real-path.md)
says a session ID that's already taken is generated again, and its costs say a
collision "has to be checked for". Comment IDs (`c_`) and review IDs (`r_`) from
[0043](0043-each-session-has-one-draft-review-and-submitted-reviews-dont-change.md)
have the same shape, and the first store code for them looked the ID up, and
generated another while it was taken.

That's a query and a loop in every insert that makes an ID, and a store option
and a test for each kind of ID that only exist to force a collision. With 6
characters of Crockford base32, there are 32⁶, about 1.07 billion, IDs of each
kind. A collision is rare enough that Dan prefers to accept it for now, and look
at a bigger keyspace later.

## Solution

- **A new ID isn't checked against the IDs already taken.** The store generates
  one ID and inserts it.
- **A collision fails the insert** on the table's primary key or unique
  constraint. The transaction rolls back, so nothing is written, and the call
  fails with an internal error. Running the command again generates another ID.
- **This applies to every generated ID:** sessions (`s_`), comments (`c_`), and
  reviews (`r_`).
- **IDs keep their shape,** `s_`, `c_`, or `r_` and 6 random characters of
  lowercase Crockford base32 from `node:crypto`, as in 0040 and 0043.

### Effect on earlier decisions

- **[0040](0040-sessions-have-short-ids-and-cover-working-directories-by-real-path.md).**
  Amended. A session ID that's already taken isn't generated again, and a
  collision fails the insert.

## Tradeoffs

Benefits:

- Inserts that make an ID run one fewer query, with no loop.
- The store has no options, and no tests, that only exist to force a collision.

Costs:

- A collision fails a call that would otherwise have worked, with an internal
  error rather than one that says what happened. With n IDs of a kind already
  stored, the chance that the next one collides is about n in 1.07 billion.

## Follow-up design choices

- **A bigger keyspace.** Whether IDs get more characters, so collisions stay
  rare as the database grows, and how that weighs against IDs that are short to
  type into a prompt.
