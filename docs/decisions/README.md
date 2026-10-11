# Decisions

Each file records one design decision: the problem, the solution, its
tradeoffs, and the follow-up design choices it leaves open. See
[`.rules/decisions.md`](../../.rules/decisions.md) for how to add one. Terms
are defined in the [glossary](../glossary.md).

| Decision | Status | Summary |
| -------- | ------ | ------- |
| [0001: The UI is a local web app](0001-local-web-app.md) | Accepted | A local server reads the repos and serves the review UI to a browser or cmux browser surface. |
| [0002: The file view can show unchanged files](0002-show-unchanged-files.md) | Accepted | Only changed files are listed by default, and a toggle lists unchanged files so the reviewer can read the code around a change. |
| [0003: The reviewer can open the code in an IDE](0003-open-in-ide.md) | Accepted | The reviewer can open the worktree, the branch, or a file at a line in an editor such as VS Code or IntelliJ. |
| [0004: The agent tree is an input, not inferred](0004-agent-tree-is-an-input.md) | Accepted, amended by [0009](0009-review-sessions-and-claims.md) | Agents and harnesses report the agent tree when agents are spawned. The app doesn't infer agents from git. |
| [0005: Agents are notified of feedback, then pull it from the server](0005-notify-then-pull-feedback.md) | Accepted, amended by [0009](0009-review-sessions-and-claims.md) | Submitted feedback triggers a short notification that wakes an idle agent, which then fetches the comments from the server. Agents never block waiting for review. |
| [0006: Review state is stored in SQLite](0006-sqlite-review-state.md) | Accepted | Review sessions, reviews, comments, claims, and delivery status are stored in a SQLite database, so they can be restored after a crash or restart. |
| [0007: The UI live-reloads by watching the file system](0007-live-reload-from-file-watching.md) | Accepted | The server watches each workspace's files and git state, so changes from any agent or human update the UI. |
| [0008: Comments are re-anchored in layers and marked outdated rather than guessed](0008-comment-reanchoring.md) | Accepted | Comments follow code by diff mapping, then strict content matching, and are otherwise marked outdated. The file contents each comment was written on are saved and shared. |
| [0009: Reviews are submitted to review sessions, and agents claim feedback per workspace](0009-review-sessions-and-claims.md) | Accepted | An actor starts a review session over a list of workspaces, reviews are submitted to it, and agents take an expiring claim on a workspace to address its feedback. |
