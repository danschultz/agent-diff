# 0001: The UI is a local web app

- Status: Accepted
- Date: 2026-10-09

## Problem

The reviewer needs a rich UI: syntax-highlighted diffs, a file tree, inline
comment threads, and live updates as agents change code. Agents need to be
able to open it on demand, and it should sit comfortably next to the
terminals the agents run in. Choices were a local web app, a native desktop
app, or a terminal UI.

## Solution

A local server reads the repos and serves the review UI to a browser. An agent
opens a review by starting the server, or reusing one that's already running,
and pointing a browser (or a cmux browser surface) at it.

## Tradeoffs

Benefits:

- The browser makes rich diff and code rendering easy, and mature libraries
  exist for diffs, syntax highlighting, and virtualized lists.
- It opens anywhere a browser does, including cmux browser surfaces, with no
  per-platform builds.
- The server has direct access to the file system and git, so the browser
  never needs repo access of its own.

Costs:

- The tool has to manage a server process: picking a port, letting agents
  find a running server, and shutting it down.
- A local server that can send feedback to agents and launch editors is an
  attack surface. Other web pages or local processes must not be able to drive
  it, so it needs to bind to localhost and require a token.
- Reviewing from a remote machine over SSH needs port forwarding.
- The reviewer leaves the terminal to review, unlike a terminal UI.

## Follow-up design choices

- One server per machine serving every review session, or one server per
  review session?
- How agents discover a running server and its port.
- How the browser authenticates to the server.
- Which frontend and backend stack to use.
- How remote and SSH workflows are supported.
