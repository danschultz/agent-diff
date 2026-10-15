# 0019: The CLI doesn't start the review server

- Status: Accepted
- Date: 2026-10-15

## Problem

[0011](0011-api-core-with-cli-client.md) has the CLI start the review server
when it isn't running, so any command can start a long-running process. That's
surprising: a command such as `agent-diff comment list` does something its name
doesn't say, and leaves a process running that nobody asked for.

## Solution

- **The review server has its own commands.** `agent-diff server start` starts
  the review server, `agent-diff server stop` stops it, and
  `agent-diff server status` says whether it's running and on which port.
- **Starting it twice is harmless.** When the review server is already running,
  `server start` says so and exits successfully.
- **No other command starts it.** Every other command fails when the review
  server isn't running, with an error that says how to fix it, for example: "The
  review server isn't running. Start it with `agent-diff server start`."

### Effect on earlier decisions

- **[0011](0011-api-core-with-cli-client.md).** The CLI still finds the review
  server and authenticates, but doesn't start it.

## Tradeoffs

Benefits:

- Each command does only what it says.
- Starting and stopping the review server are deliberate, visible steps.
- Agents in sandboxes and containers don't leave server processes running that
  nobody started on purpose.
- When the review server isn't running, the error says so, rather than a command
  quietly taking longer while a server starts.

Costs:

- In a new environment, the first command fails until someone runs
  `server start`, which costs an agent an extra step.
- Someone has to start the review server again after a restart, or a harness has
  to.

## Follow-up design choices

- **Running in the background.** Whether `server start` stays in the foreground
  or detaches, and where its logs go.
- **Stopping with active review sessions.** Whether `server stop` warns or asks
  first when review sessions are active.
- **Starting automatically.** Whether harnesses run `server start`, or the
  review server can be set to start when the user logs in.
- **Server discovery and auth.** How the CLI finds a running review server, its
  port, and its token, still open from 0011.
