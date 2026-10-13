# Research

Each file records research into a question: the findings, the options they
suggest, and what couldn't be checked. Research doesn't propose or decide
anything. Choices are recorded as [decisions](../decisions/README.md). See
[`.rules/research.md`](../../.rules/research.md) for how to add research.
Terms are defined in the [glossary](../glossary.md).

| Research | Summary |
| -------- | ------- |
| [0001: How should the project board stay up to date?](0001-keeping-the-project-board-up-to-date.md) | GitHub's built-in workflows can't set Status from labels, so keeping the board in sync with the `agent:*` labels needs a GitHub Actions workflow, `implement` setting Status as it moves labels, or `implement` reconciling the board on each tick. |
| [0002: Which TypeScript CLI libraries could build the `agent-diff` CLI?](0002-typescript-cli-libraries.md) | Of 20 CLI libraries checked, 17 were used to write the same example CLI: small typed parsers such as Commander, Stricli, and Crust start near the `parseArgs` baseline but only expose a full or machine-readable reference through APIs or build steps, while agent-oriented frameworks such as incur and Padrone print one from the CLI itself at the cost of 15 MB or more and about three times the startup time. |
