# Decisions

Each file records one design decision: the problem, the solution, its
tradeoffs, and the follow-up design choices it leaves open. See
[`.rules/decisions.md`](../../.rules/decisions.md) for how to add one. Terms
are defined in the [glossary](../glossary.md).

| Decision | Status | Summary |
| -------- | ------ | ------- |
| [0001: The UI is a local web app](0001-local-web-app.md) | Accepted | A local server reads the repos and serves the review UI to a browser or cmux browser surface. |
| [0002: The file view can show unchanged files](0002-show-unchanged-files.md) | Accepted | Only changed files are listed by default, and a toggle lists unchanged files so the reviewer can read the code around a change. |
| [0003: The reviewer can open the code in an IDE](0003-open-in-ide.md) | Accepted, amended by [0013](0013-working-directories.md) | The reviewer can open the working directory, the branch, or a file at a line in an editor such as VS Code or IntelliJ. |
| [0004: The agent tree is an input, not inferred](0004-agent-tree-is-an-input.md) | Accepted, amended by [0009](0009-review-sessions-and-claims.md) | Agents and harnesses report the agent tree when agents are spawned. The app doesn't infer agents from git. |
| [0005: Agents are notified of feedback, then pull it from the server](0005-notify-then-pull-feedback.md) | Accepted, amended by [0009](0009-review-sessions-and-claims.md), [0010](0010-user-prompts-agent-to-fetch-review.md), and [0011](0011-api-core-with-cli-client.md) | Submitted feedback triggers a short notification that wakes an idle agent, which then fetches the comments from the server. Agents never block waiting for review. |
| [0006: Review state is stored in SQLite](0006-sqlite-review-state.md) | Accepted, amended by [0010](0010-user-prompts-agent-to-fetch-review.md) | Review sessions, reviews, comments, claims, and delivery status are stored in a SQLite database, so they can be restored after a crash or restart. |
| [0007: The UI live-reloads by watching the file system](0007-live-reload-from-file-watching.md) | Accepted | The server watches each working directory's files and git state, so changes from any agent or human update the UI. |
| [0008: Comments are re-anchored in layers and marked outdated rather than guessed](0008-comment-reanchoring.md) | Accepted | Comments follow code by diff mapping, then strict content matching, and are otherwise marked outdated. The file contents each comment was written on are saved and shared. |
| [0009: Reviews are submitted to review sessions, and agents claim feedback per working directory](0009-review-sessions-and-claims.md) | Accepted, amended by [0010](0010-user-prompts-agent-to-fetch-review.md) and [0013](0013-working-directories.md) | An actor starts a review session over a list of working directories, reviews are submitted to it, and agents take an expiring claim on a working directory to address its feedback. |
| [0010: The user prompts the agent to fetch the latest review](0010-user-prompts-agent-to-fetch-review.md) | Accepted, amended by [0011](0011-api-core-with-cli-client.md) and [0013](0013-working-directories.md) | After submitting a review, the reviewer tells the agent to apply it, and the agent fetches the most recent review with `agent-diff review`. The review server never contacts agents. |
| [0011: The review server has an API, and agents use a CLI that calls it](0011-api-core-with-cli-client.md) | Accepted | The review server's HTTP API is the core, used by the review UI and by the `agent-diff` CLI, which agents and harnesses use. There's no MCP server. |
| [0012: The review UI renders diffs with CodeMirror](0012-codemirror-renders-diffs.md) | Accepted | CodeMirror 6 with `@codemirror/merge` renders diffs, chosen over Monaco, git-diff-view, and a custom table after measuring load time, memory, live reload, and scrolling. |
| [0013: Review sessions cover working directories, which don't have to use git](0013-working-directories.md) | Accepted | A working directory is any directory, git or not. Only files under it are shown, the branch is whatever `HEAD` points to, and directories that don't use git show all files with no diffs. |
