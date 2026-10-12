# Recording decisions

Record a decision whenever the user settles a design question, including
answering an open question in `README.md`.

## Steps

1. Create `docs/decisions/NNNN-short-title.md`, where `NNNN` is the next
   number in sequence, zero-padded to four digits.
2. Use the template below. Every section is required.
3. Add a row to the table in `docs/decisions/README.md` with a link, the
   status, and a one-sentence summary.
4. Update `README.md`:
   - Change the product description if the decision affects it.
   - Remove any open question the decision answers.
5. If the decision replaces an earlier one, don't delete the old file. Set its
   status to `Superseded by NNNN`, link to the new decision, and update its
   row in the index.
6. If the decision changes only part of an earlier one, set the earlier
   decision's status to `Accepted, amended by NNNN`. Add a short note at the
   top of it saying what changed, linking to the new decision, and update its
   row in the index.
7. If the decision introduces or changes terms, update `docs/glossary.md`
   following [`.rules/glossary.md`](glossary.md).
8. If the decision accepts a proposal from `docs/research`, link to the
   research in the decision's Problem section, and update the research's
   status following [`.rules/research.md`](research.md).

Follow-up design choices belong in the decision file. Keep `README.md`'s open
questions for questions that aren't tied to a single decision.

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
