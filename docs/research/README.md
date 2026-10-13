# Research

Each file records research into a question: the findings, the options they
suggest, and what couldn't be checked. Research doesn't propose or decide
anything. Choices are recorded as [decisions](../decisions/README.md). See
[`.rules/research.md`](../../.rules/research.md) for how to add research.
Terms are defined in the [glossary](../glossary.md).

| Research | Summary |
| -------- | ------- |
| [0001: How should the project board stay up to date?](0001-keeping-the-project-board-up-to-date.md) | GitHub's built-in workflows can't set Status from labels, so keeping the board in sync with the `agent:*` labels needs a GitHub Actions workflow, `implement` setting Status as it moves labels, or `implement` reconciling the board on each tick. |
| [0002: How could the review server be split into a few deep modules?](0002-review-server-deep-modules.md) | The review server's domain has review, anchoring, working directory contents, and agents contexts, with most of its complexity in the git layer and re-anchoring, and could be split into four modules by context, eight by aggregate, or layers around a pure domain. |
