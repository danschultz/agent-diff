# Research

Each file records research into a question: the findings, the options they
suggest, and what couldn't be checked. Research doesn't propose or decide
anything. Choices are recorded as [decisions](../decisions/README.md). See
[`.rules/research.md`](../../.rules/research.md) for how to add research.
Terms are defined in the [glossary](../glossary.md).

| Research | Summary |
| -------- | ------- |
| [0001: How should the project board stay up to date?](0001-keeping-the-project-board-up-to-date.md) | GitHub's built-in workflows can't set Status from labels, so keeping the board in sync with the `agent:*` labels needs a GitHub Actions workflow, `implement` setting Status as it moves labels, or `implement` reconciling the board on each tick. |
| [0002: Which React state management library fits the review UI?](0002-react-state-management.md) | Compared plain React and ten libraries for the review UI's state on size (0 to 13.6 KB gzipped), type safety, code for the same drafts example (15 to 45 lines), maintenance, agent-friendliness, and server-pushed updates, with all examples type-checked and run on React 19. |
