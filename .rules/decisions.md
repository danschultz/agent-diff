# Recording decisions

Record a decision whenever the user settles a design question, including
answering an open question in `README.md`.

## Steps

1. Create `docs/decisions/NNNN-short-title.md`, where `NNNN` is the next number
   in sequence, zero-padded to four digits. `npm run check` fails when two
   decisions have the same number. When the number is already taken on `main`,
   such as after a rebase, move the newer decision to the next free number, and
   update the links to it and its row in `docs/decisions/README.md`.
2. Use the template below. Every section is required.
3. Add a row to the table in `docs/decisions/README.md` with a link, the status,
   and a one-sentence summary.
4. Update `README.md`:
   - Change the product description if the decision affects it.
   - Remove any open question the decision answers.
5. If the decision replaces an earlier one, don't delete the old file. Set its
   status to `Superseded by NNNN`, link to the new decision, and update its row
   in the index.
6. If the decision changes only part of an earlier one, set the earlier
   decision's status to `Accepted, amended by NNNN`. Add a short note at the top
   of it saying what changed, linking to the new decision, and update its row in
   the index.
7. If the decision introduces or changes terms, update `docs/glossary.md`
   following [`.rules/glossary.md`](glossary.md).
8. If the decision builds on research in `docs/research`, link to it from the
   decision's Problem section.

Follow-up design choices belong in the decision file. Keep `README.md`'s open
questions for questions that aren't tied to a single decision.

## What a decision records

Every detail in a decision is one a build brief must escalate to change. So
record only what the user would want to agree to before it changes: behavior
that reviewers or agents see, the API's shape, choices that are expensive to
undo, and rules other work depends on.

Leave out details of how it's done when a test or the code settles them better,
such as exact commands, pixel distances, time limits, or pinned versions. State
the goal instead, such as "the review server never writes to the repo, and a
test checks that `.git` doesn't change". Those details go in the build brief,
the code, and its comments, and changing them doesn't need a new decision.

## Template

```markdown
# NNNN: Short title stated as the decision

- Status: Accepted
- Date: YYYY-MM-DD

## Problem

What needed deciding, and why it matters.

## Solution

What was decided.

## Tradeoffs

Benefits:

- ...

Costs:

- ...

## Follow-up design choices

- Questions this decision leaves open.
```
