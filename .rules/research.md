# Recording research

Record research whenever the user asks for options to be investigated, or a
brief asks for research. Research compares approaches and ends with a
proposal. It doesn't settle anything: once the user agrees on an approach,
record a decision following [`.rules/decisions.md`](decisions.md).

## Steps

1. Create `docs/research/NNNN-short-title.md`, where `NNNN` is the next
   number in sequence, zero-padded to four digits. Research has its own
   sequence, separate from decisions.
2. Use the template below. Every section is required. Write "None" in a
   section that has nothing to say.
3. Add a row to the table in `docs/research/README.md` with a link, the
   status, and a one-sentence summary.
4. Cite sources: link to the docs, pages, or code each finding comes from.
   Say what was checked by hand, such as a command that was run, and what
   couldn't be checked.
5. Use glossary terms as defined, following
   [`.rules/glossary.md`](glossary.md). Research doesn't add terms to the
   glossary. Propose new terms to the user instead.

## Status

| Status | Meaning |
| ------ | ------- |
| Proposed | The research is done and its proposal is waiting for the user. |
| Accepted in NNNN | The user agreed on an approach, recorded in decision NNNN. Link to it. |
| Rejected | The user decided against all the proposals. Add a short note at the top saying why. |
| Superseded by NNNN | Later research replaces this. Link to it. |

When the status changes, update it in the file and in its row in the index.
Don't delete research files or rewrite their findings.

## Template

```markdown
# NNNN: Short title stated as the question

- Status: Proposed
- Date: YYYY-MM-DD

## Question

What needs answering, why it matters, and what a good answer must do.

## Findings

Facts learned while researching, with sources.

## Options

Each approach considered, with its benefits and costs.

## Proposal

The recommended approach, and how to implement it.

## Open questions

- Questions the user needs to answer before the proposal can be accepted.
```
