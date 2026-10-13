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
Prettier and a pre-commit hook that runs `npm run check` and blocks the commit
when it fails. CI runs the same script on pushes to `main` and on pull requests.

- `npm run format` formats every file Prettier supports, skipping files the root
  `.gitignore` ignores.
- `npm run format:check` lists the files that aren't formatted.
- `npm run check` runs every check. To add a check, add an npm script for it and
  append it to the `check` script in the root `package.json`, such as
  `npm run format:check && npm run lint`.
