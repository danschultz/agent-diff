# Recording research

Record research whenever the user asks for options to be investigated, or a
brief asks for research.

Research is findings only: what was learned, and the options it suggests, with
their benefits and costs. It doesn't recommend, propose, or approve anything,
and it has no status. When the user settles a question, record a decision
following [`.rules/decisions.md`](decisions.md). The decision can link to the
research it builds on.

## Steps

1. Create `docs/research/NNNN-short-title.md`, where `NNNN` is the next number
   in sequence, zero-padded to four digits. Research has its own sequence,
   separate from decisions. `npm run check` fails when two research docs have
   the same number. When the number is already taken on `main`, such as after a
   rebase, move the newer research doc to the next free number, and update the
   links to it and its row in `docs/research/README.md`.
2. Use the template below. Every section is required. Write "None" in a section
   that has nothing to say.
3. Add a row to the table in `docs/research/README.md` with a link and a
   one-sentence summary of what was found.
4. Cite sources: link to the docs, pages, or code each finding comes from. Say
   what was checked by hand, such as a command that was run, and what couldn't
   be checked.
5. Use glossary terms as defined, following [`.rules/glossary.md`](glossary.md).
   Research doesn't add terms to the glossary. Propose new terms to the user
   instead.

Research records what was true on its date. Don't rewrite old findings. If they
go out of date, write new research and link to the old one.

## Template

```markdown
# NNNN: Short title stated as the question

- Date: YYYY-MM-DD

## Question

What was researched, and why it matters.

## Findings

Facts learned while researching, with sources.

## Options

Each approach found, with its benefits and costs.

## Gaps

What couldn't be found out or checked, and why.
```
