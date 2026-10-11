# 0011: The review server has an API, and agents use a CLI that calls it

- Status: Accepted
- Date: 2026-10-11

## Problem

Agents, harnesses, and the review UI all need to drive the review server:
start and end review sessions, add workspaces, take claims, and fetch
reviews. Earlier decisions left the interface open, suggesting a CLI, an MCP
server, or both ([0005](0005-notify-then-pull-feedback.md),
[0010](0010-user-prompts-agent-to-fetch-review.md)).

The review UI needs an HTTP API whatever is chosen, because the browser
talks to the review server ([0001](0001-local-web-app.md)). So the choice is
which interface agents and harnesses use:

- **API only.** Every caller has to find the server and its port, handle
  the auth token, and send its working directory. Agents are error-prone
  with raw HTTP, and an HTTP call can't start a server that isn't running.
- **CLI only.** The CLI can handle all of that once, but the review UI still
  needs an API, so the CLI would need to work without one or duplicate the
  server's logic.

## Solution

- **The API is the core.** The review server provides an HTTP API, and all
  behavior goes through it. The review UI and the CLI both call it.
- **The CLI calls the API.** `agent-diff` is a client of the API, not a
  second implementation. It doesn't read or write the SQLite database
  directly.
- **Agents and harnesses use the CLI.** It's the documented interface for
  them. The CLI handles finding the review server, starting it when it isn't
  running, authenticating, and working out the workspace from the working
  directory.
- **No MCP server.** None is planned. Agents run the CLI from their shell.

## Tradeoffs

Benefits:

- One implementation of the behavior, in the review server, shared by the
  review UI and the CLI.
- Finding the server, starting it, authenticating, and looking up the
  workspace are solved once, in the CLI, instead of by every agent and
  harness.
- Agents run short commands like `agent-diff review` rather than writing
  HTTP requests.
- Works with any agent that has a shell, with nothing installed into the
  agent's config.
- Harnesses can call the API directly later if the CLI isn't enough.

Costs:

- Two interfaces to maintain, and the CLI has to keep up with the API.
- The CLI must be installed wherever agents run, including sandboxes and
  containers, and must work with the version of the review server it finds.
- Harnesses integrate by running a process and reading its output rather
  than by calling a library or API.
- Starting a process for every call costs a little, which matters most for
  frequent calls such as renewing a claim.
- Agents that can't run shell commands can't use `agent-diff` without an
  MCP server or similar.

## Follow-up design choices

- **API stability.** Whether the API is internal at first, or a documented
  interface that harnesses can rely on.
- **Output format.** Whether the CLI prints text formatted for a language
  model, JSON, or both (for example with a `--json` flag).
- **Command set.** The CLI commands and the API calls behind them, together
  with the API shape left open in
  [0009](0009-review-sessions-and-claims.md).
- **Server discovery and auth.** How the CLI finds a running review server,
  its port, and its token, as left open in [0001](0001-local-web-app.md).
- **Version mismatch.** What the CLI does when the review server it finds
  is a different version.
