# 0037: Agents get review messages through a listener they start on the session

- Status: Accepted
- Date: 2026-10-22

## Problem

[0036](0036-the-reviewer-submits-reviews-and-the-agent-gets-a-review-message.md)
has the review server send a review message to an agent session when a review is
submitted. An agent session in a terminal isn't listening for anything between
turns, so the review message needs a way in that starts a turn when it's idle,
and doesn't lose the message when it's busy.

[Research 0007](../research/0007-messaging-agent-sessions.md) compared the ways
found for Claude Code and the Cursor CLI. A background process the agent starts
is the only one that starts a turn in an interactive agent session in both
([A background process the agent starts](../research/0007-messaging-agent-sessions.md#a-background-process-the-agent-starts)).
It has variants, and the review server also needs to know which agent session
each review message is for.

## Solution

### The listener

- **`agent-diff session listen <session-id>`** connects to the review server and
  waits for review messages for that session. It prints each one as a single
  line on stdout, and keeps running.
- **Nothing else goes to stdout,** since each line starts a turn. Errors go to
  stderr, and the listener reconnects on its own when the connection drops.
- **The listener tells the review server** once it has printed a review message,
  and the review server counts it as sent only then. A review message the
  listener didn't print is held, as in 0036.
- **The CLI reads the token from the config file**
  ([0024](0024-config-file-holds-port-and-token.md)), so it never appears in the
  command, the agent's transcript, or the review message.

### Starting it

- **The agent starts the listener** in the background, with the same command in
  both agents:
  - **Claude Code:** with the Monitor tool, which turns each printed line into
    an event. A Monitor watch ends after at most 30 minutes, and the agent gets
    a notice and starts it again. Review messages sent in between are held.
  - **Cursor CLI:** as a background shell command that notifies the agent when
    its output matches `[agent-diff review`, so each line starts a turn and the
    listener keeps running. The notice doesn't include the line, so the agent
    reads the command's output.
- **`agent-diff session new` prints how to start it.** After the session's ID
  and the review UI's URL, it prints the listener command and how to run it in
  each agent, so the agent that started the session starts listening on it.
- **There's no plugin, hook, or config to install,** and it works in an agent
  session that's already running.

### Addressing

- **Review messages are addressed by session ID.** Whoever listens on a session
  gets its review messages. Normally that's the agent that started it, by
  following `session new`'s output. The review server doesn't need agent session
  IDs, and the same approach works in both agents.
- **A human who starts a session** asks an agent to run the listener, or copies
  the review message from the review UI.
- **With a fleet,** the main agent listens and hands work to its sub-agents. The
  docs say a background command started by a foreground sub-agent stops when the
  sub-agent finishes, so sub-agents shouldn't be the ones listening.

### What wasn't chosen

- **A Claude Code plugin monitor.** It starts with the agent session and has no
  30-minute limit, but it starts before any session exists, so it can only
  listen by `CLAUDE_CODE_SESSION_ID`. That's a second way to address agent
  sessions, and Claude Code only.
- **Monitor's WebSocket source.** It needs no process, but it's Claude Code
  only, it wasn't tested, and the token would go in the URL, where the
  transcript shows it.
- **A background command that exits on each message.** It works in both agents,
  but the agent has to start it again after every review message.
- **Every other option in research 0007,** such as channels, an MCP tool call
  that waits, and messaging between agent sessions, which only work in one agent
  or can't reach an agent session a human started.

## Tradeoffs

Benefits:

- One command and one way of addressing for both agents.
- Nothing to install, and nothing typed into the agent's terminal.
- The review server only needs one more API call for the listener, and doesn't
  track agent sessions.
- The token stays out of the transcript.

Costs:

- The listener only runs if the agent starts it, so it depends on the agent
  following `session new`'s output, or on the human asking.
- In Claude Code, an idle agent session gets a turn every 30 minutes to start
  the Monitor watch again, which costs tokens while nothing is happening.
- Monitor isn't available on Bedrock, Vertex, or Foundry, or with telemetry
  turned off. Those users fall back to copying the review message.
- The Cursor CLI's watched background shell is only in its changelog and bundle,
  not its docs, so an update could change it.
- In Claude Code, a review message for a busy agent session joins the running
  turn after the current tool call. In the Cursor CLI, it waits for the turn to
  end. The two agents behave differently.
- When the agent session exits, the listener stops, and review messages are held
  with no sign of whether it will come back.
- The listener's output reaches the model as instructions. Only something
  holding the token can send a review message, and its text is fixed by the
  review server.

## Follow-up design choices

- **Several listeners.** Whether a review message goes to every listener on a
  session, the most recent, or the first to take it.
- **Showing listeners.** Whether the review UI shows that a listener is
  connected, and for how long it's been gone.
- **The review server stopping.** Whether the listener prints a line when the
  review server stops or restarts, which would wake the agent, or stays quiet
  and keeps reconnecting.
- **Avoiding the 30-minute restart.** Whether to add the plugin monitor later as
  a Claude Code convenience, on top of the same listener command.
- **Other agents.** The Codex CLI and OpenCode, read in docs only in research
  0007, and whether their own ways of sending a prompt replace the listener.
