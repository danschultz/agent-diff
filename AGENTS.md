# AGENTS.md

Read [README.md](README.md) first. It describes what `agent-diff` is, the review
workflow, diff modes, and open design questions. Design decisions are recorded
in [docs/decisions](docs/decisions/README.md), research into open questions is
in [docs/research](docs/research/README.md), and agreed terms are defined in
[docs/glossary.md](docs/glossary.md).

## Guidelines

- The project is in the planning stage. Don't start implementing until a design
  or task has been agreed with the user.
- Keep `README.md` as the source of truth for product intent.

## Rules

| Rule                                           | When to read                                                                        |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| [`.rules/glossary.md`](.rules/glossary.md)     | Always                                                                              |
| [`.rules/decisions.md`](.rules/decisions.md)   | When the user settles a design question or answers an open question in `README.md`. |
| [`.rules/research.md`](.rules/research.md)     | When the user or a brief asks for options to be researched.                         |
| [`.rules/formatting.md`](.rules/formatting.md) | When a change adds a file type the repo doesn't have yet.                           |
| [`.rules/gitignore.md`](.rules/gitignore.md)   | When adding or changing ignore patterns.                                            |

## Checks

Run `npm install` at the repo root once per checkout or worktree. It installs
Prettier, remark, and a pre-commit hook that runs `npm run check` and blocks the
commit when it fails. CI runs the same script on pushes to `main` and on pull
requests. The checks run on the working tree, not only what's staged.

- `npm run format` formats every file Prettier supports, skipping files the root
  `.gitignore` ignores.
- `npm run format:check` lists the files that aren't formatted.
- `npm run lint:docs` runs `scripts/lint-docs.ts`, which never changes files. It
  fails when:
  - Two `.md` files directly in `docs/decisions/`, or two in `docs/research/`,
    have the same number. Numbers are compared as numbers, so `0002` and `2`
    match. A decision and a research doc can share a number.
  - A Markdown file has a local link or image to a file or folder that doesn't
    exist or that git ignores, or to a heading that doesn't exist. Headings
    follow GitHub's anchor rules.
  - A Markdown file has a local link that leaves the repo: a relative path that
    resolves outside it, an absolute path such as `/docs/glossary.md`, or a
    `file:` URL.

  Every Markdown file the root `.gitignore` doesn't ignore is checked. Links
  with another URL scheme, such as `https:`, and links in code aren't checked.
  The link checks are `remark-validate-links` and
  `scripts/remark-local-links.ts`, configured in `.remarkrc.js`.

- `npm test` runs the tests for `scripts/` with `node --test`.
- `npm run check` runs every check. To add a check, add an npm script for it and
  append it to the `check` script in the root `package.json`, which today is
  `npm run format:check && npm run lint:docs && npm test`.
