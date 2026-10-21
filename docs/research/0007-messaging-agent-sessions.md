# 0007: How can the review server send a message to a running agent session, and get a reply?

- Date: 2026-10-21

## Question

Dan asked for research into how the
[review server](../glossary.md#review-server) could send a message to a running
[agent session](../glossary.md#agent-session), and how the
[agent](../glossary.md#agent) could send a message back in reply, so Dan can
decide whether and how `agent-diff` does this. Both directions matter:

- **Review server to agent:** a message reaches an agent session, whether it's
  idle, busy in the middle of a [turn](../glossary.md#turn), or waiting on the
  user, and starts a turn if it's idle.
- **Agent to review server:** the agent sends a message back that the review
  server can tie to the message it's answering.

What matters is an interactive agent session that's waiting for its next prompt,
the way a human uses it in a terminal, not only print or headless modes. The
research covers two agents by hand, Claude Code and the Cursor CLI, and the
Codex CLI, OpenCode, and the Agent Client Protocol (ACP) from their docs only.

Two approaches were ruled out before the research started, and weren't tried:

- Typing the review server's messages into the agent's terminal, such as with
  tmux `send-keys`. Tests used tmux only to start an agent and type its starting
  prompt, or to answer a dialog, as a human would.
- Agent hooks, such as Claude Code's `Stop` or `UserPromptSubmit` hooks or
  Cursor's `stop` hook, as the way messages reach the agent.

## Findings

### How this was checked

- **Agents.**
  - Claude Code 2.1.306, logged in to a Claude Pro subscription. Most runs used
    `--model haiku` (Haiku 5.5) to keep turns cheap. Some used `--model sonnet`
    (Sonnet 5.5).
  - The Cursor CLI (`cursor-agent`), logged in to Dan's account on the Vertex
    team. It was 2026.09.26-dd393fe when the research started, and updated
    itself to 2026.10.19-6bbf2c4 at about 04:35 UTC during the first runs. Every
    Cursor result below is from 2026.10.19-6bbf2c4 unless it says otherwise.
  - Node 26.11.1 ran the prototypes, with type stripping for `.ts` files.
- **Interactive agent sessions.** Each agent ran in a pseudo-terminal on its own
  tmux server, and the screen was read with `tmux capture-pane`. tmux typed only
  the starting prompt and answered trust, warning, and permission dialogs. The
  review server's messages never went through the terminal.
- **Starting Claude Code inside Claude Code.** The research ran inside a Claude
  Code agent session, which sets `CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`,
  `CLAUDE_CODE_MESSAGING_SOCKET`, `CLAUDE_CODE_MESSAGING_TOKEN`, and other
  `CLAUDE_*` variables in its child processes. `claude` still started in tmux
  with them set. To keep the test agent session from inheriting the parent's
  identity and inbox socket, each tmux server was started with a clean
  environment:
  `env -i HOME=$HOME PATH=$PATH TERM=xterm-256color LANG=C.UTF-8 tmux -L <name> ...`.
  Whether the inherited variables would have changed any result wasn't tested.
- **Busy and permission prompts.** A busy agent session was running a 30 s
  script in the foreground, such as `busy.sh` or
  `node -e "setTimeout(()=>{},30000)"`. Claude Code blocks a plain `sleep 30` in
  the foreground. A permission prompt came from starting the agent session in
  its default permission mode and asking it to run a command that wasn't
  allowed.
- **Prototypes.** Each option has a prototype server in
  [`0007-messaging-agent-sessions/`](0007-messaging-agent-sessions/), one
  directory per option, listed in [Prototypes](#prototypes). Each one, apart
  from Remote Control's, sends a message with an ID and logs the reply with that
  ID and the time since the send. Latencies below come from those logs, with
  timestamps.
- **Sources.** Every source was read on 2026-10-21. Claude Code docs at
  `code.claude.com/docs` describe 2.1.306. Cursor docs at `cursor.com/docs` are
  unversioned. Findings marked "read in the binary" come from strings in the
  installed Claude Code 2.1.306 binary or the Cursor CLI's bundled `index.js`,
  which are internals and can change in any release.

### Options at a glance

Each cell says whether the option works for that agent, checked by hand; doesn't
work, and where it stopped; or doesn't apply to that agent, and why.

| Option                                                                                  | Claude Code 2.1.306                                                                                                                                                            | Cursor CLI 2026.10.19-6bbf2c4                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Claude Code channels](#claude-code-channels)                                           | Works, checked by hand.                                                                                                                                                        | Doesn't apply: channels are a Claude Code feature. The Cursor CLI ignored a `notifications/claude/channel` notification, checked by hand under [Standard MCP notifications](#standard-mcp-notifications).                                          |
| [Standard MCP notifications](#standard-mcp-notifications)                               | Doesn't work: no notification or request started a turn or reached the model, checked by hand.                                                                                 | Doesn't work: no notification or request started a turn or reached the model, checked by hand.                                                                                                                                                     |
| [An MCP tool call that waits for a message](#an-mcp-tool-call-that-waits-for-a-message) | Works, checked by hand, because Claude Code moves a tool call that runs past 2 minutes to the background and wakes the agent when it ends.                                     | Doesn't work: every MCP tool call times out after 60 s, and a message sent when no call is waiting doesn't start a turn, checked by hand. A short wait within a turn works.                                                                        |
| [Messaging between agent sessions](#messaging-between-agent-sessions)                   | Works, checked by hand.                                                                                                                                                        | Doesn't apply: the Cursor CLI has no inbox for messages from other processes. Its hidden `worker-server` only serves indexing and file routes, read in the bundle.                                                                                 |
| [A background process the agent starts](#a-background-process-the-agent-starts)         | Works, checked by hand, with the Monitor tool, or a background command that exits when a message arrives. A background command that keeps printing doesn't reach the agent.    | Works, checked by hand, with a background shell command that exits when a message arrives, or a watched background shell that notifies the agent when its output matches a pattern.                                                                |
| [A prompt to a background agent session](#a-prompt-to-a-background-agent-session)       | Works, checked by hand, for an agent session started with `claude --bg`.                                                                                                       | Doesn't work: `cursor-agent persist` only lists, attaches, and stops agent sessions. `--resume <chatId> "prompt"` from another terminal takes over the human's terminal without sending the prompt, and `-p --resume` is refused, checked by hand. |
| [Print mode with `--resume`](#print-mode-with---resume)                                 | Doesn't work: it runs a separate process on the stored conversation, and the running agent session never sees the message, checked by hand.                                    | Doesn't work: as for Claude Code, and the next turn in the interactive agent session overwrote the print-mode turn, checked by hand.                                                                                                               |
| [An SDK that owns the agent session](#an-sdk-that-owns-the-agent-session)               | Works for agent sessions the review server starts with the Agent SDK, checked by hand. It can't reach an agent session a human started in the terminal.                        | Doesn't work: `@cursor/sdk` 1.0.40 needs a Cursor API key, not the CLI's login, and runs failed with `Invalid User API Key`, checked by hand. `cursor-agent -p` has no streaming input.                                                            |
| [ACP mode](#acp-mode)                                                                   | Doesn't apply: Claude Code has no ACP mode. A third-party adapter wraps the Agent SDK, read in docs only.                                                                      | Works for agent sessions the review server starts with `cursor-agent acp`, checked by hand. It can't reach an agent session a human started in the terminal.                                                                                       |
| [Remote Control](#remote-control)                                                       | Doesn't work: only claude.ai, the Claude apps, and other Claude Code agent sessions can send. There's no API, local endpoint, or command for another program, checked by hand. | Doesn't work: the CLI has no Remote Control. Cursor's Remote Control, Cloud Agents API, and `worker` only reach cloud agents, checked by hand and in the docs.                                                                                     |
| [Codex CLI app-server and `codex queue`](#codex-cli-app-server-and-codex-queue)         | Doesn't apply: a Codex CLI feature, read in docs only.                                                                                                                         | Doesn't apply: a Codex CLI feature, read in docs only.                                                                                                                                                                                             |
| [OpenCode server](#opencode-server)                                                     | Doesn't apply: an OpenCode feature, read in docs only.                                                                                                                         | Doesn't apply: an OpenCode feature, read in docs only.                                                                                                                                                                                             |
| [ACP in general](#acp-in-general)                                                       | Doesn't apply: a protocol, read in docs only. See [ACP mode](#acp-mode) for the agents.                                                                                        | Doesn't apply: a protocol, read in docs only. See [ACP mode](#acp-mode) for the Cursor CLI.                                                                                                                                                        |

### How each option behaves

Every option in the first table, by agent where they differ. Where an option
doesn't reach a running agent session, the cells say so.

| Option                                                              | Stability                                                                                                                                 | Setup                                                                                                                                                                                    | Reaching an idle agent session                                                                                                                        | When it's busy                                                                                                                       | How the reply comes back                                                                                                              | How the reply is tied to the message                                                                     |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Claude Code channels                                                | Research preview.                                                                                                                         | Start the agent session with the hidden `--dangerously-load-development-channels server:<name>` flag, and accept a warning every launch. A project `.mcp.json` names the channel server. | The channel server sends `notifications/claude/channel`, and a turn starts about 0.1 s later.                                                         | The message waits, and joins the same turn when the running tool call ends.                                                          | The agent calls the channel server's reply tool.                                                                                      | A `message_id` in the notification's `meta`, which the agent passes back to the reply tool.              |
| Standard MCP notifications (both agents)                            | Standard MCP.                                                                                                                             | A project MCP server.                                                                                                                                                                    | Doesn't: no notification or request starts a turn or reaches the model.                                                                               | Doesn't reach the model either.                                                                                                      | None.                                                                                                                                 | None.                                                                                                    |
| An MCP tool call that waits for a message (Claude Code)             | Documented.                                                                                                                               | A project MCP server with a tool that blocks until a message arrives. The agent has to call it, and call it again after each message.                                                    | After 2 minutes the call moves to the background. Its result arrives as a task notification that starts a turn, about 0.13 s after the send.          | The task notification joins the same turn when the running tool call ends.                                                           | The agent calls a reply tool on the same MCP server.                                                                                  | The message ID in the tool result, passed back to the reply tool.                                        |
| An MCP tool call that waits for a message (Cursor CLI)              | MCP tools are documented. The 60 s timeout isn't, apart from a forum thread.                                                              | As for Claude Code, but run from the git root, and over HTTP because of the sandbox.                                                                                                     | Doesn't: every call times out after 60 s, and a message sent when no call is waiting stays on the review server until the agent calls the tool again. | A waiting call can run alongside other tool calls, and the model sees its result when they end.                                      | The agent calls a reply tool on the same MCP server.                                                                                  | The message ID in the tool result, passed back to the reply tool.                                        |
| Messaging between agent sessions (Claude Code)                      | Documented and on by default, but the message format and the socket's location are only in the binary.                                    | None in the agent session. The review server finds the socket in `~/.claude/sessions/<pid>.json`.                                                                                        | The review server writes one JSON line to the agent session's inbox socket, and a turn starts.                                                        | The message is read between tool calls, without interrupting the running one.                                                        | The agent calls `SendMessage` to a socket the review server binds, or runs `curl`.                                                    | An ID in the message text, which the agent copies into its reply.                                        |
| A background process: the Monitor tool (Claude Code)                | Documented.                                                                                                                               | The agent starts the listener with Monitor when asked, or a plugin's monitor starts it with the agent session. A watch the agent starts ends after at most 30 minutes.                   | Each line the listener prints is an event that starts a turn.                                                                                         | The event joins the same turn when the running tool call ends.                                                                       | The agent runs the reply command the line names, which writes to the listener's socket.                                               | The message ID in the printed line, passed to the reply command.                                         |
| A background process: a background command that exits (both agents) | Claude Code: documented, but the docs don't say that the command ending starts a turn. Cursor CLI: undocumented apart from its changelog. | The agent starts the listener in the background when asked, and again after each message.                                                                                                | The command ending starts a turn, and the agent reads its output.                                                                                     | Handled in the same turn after the running tool call, in both agents.                                                                | The agent runs the reply command the output names.                                                                                    | The message ID in the output, passed to the reply command.                                               |
| A background process: a watched background shell (Cursor CLI)       | Undocumented apart from its changelog.                                                                                                    | The agent starts the listener as a background shell and asks to be notified when its output matches a pattern, when asked in plain words.                                                | Each match starts a turn, and the agent reads the output.                                                                                             | The message waits for the turn to end, then starts a new turn.                                                                       | The agent runs the reply command the output names.                                                                                    | The message ID in the output, passed to the reply command.                                               |
| A prompt to a background agent session (Claude Code)                | Documented. Background agent sessions are part of agent view, a research preview.                                                         | The human starts the agent session with `claude --bg`. The review server runs `claude --resume <id> "<message>"` in a pseudo-terminal.                                                   | The message is queued as the next prompt, and a turn starts.                                                                                          | The message joins the same turn when the running tool call ends.                                                                     | The agent runs a command the message names, which posts to the review server.                                                         | An ID in the message text, passed to the reply command.                                                  |
| Print mode with `--resume` (both agents)                            | Documented.                                                                                                                               | The review server needs the conversation's ID, and runs the agent in print mode with `--resume`.                                                                                         | Doesn't reach the running agent session: a separate process answers from the stored conversation.                                                     | Same: the separate process runs at once and doesn't wait.                                                                            | The process's output.                                                                                                                 | It's that process's output.                                                                              |
| An SDK that owns the agent session (Claude Code)                    | Documented. The `priority` field is only in the SDK's types.                                                                              | The review server starts the agent session with the Agent SDK's `query()` and owns it.                                                                                                   | Pushing a user message into the stream starts a turn.                                                                                                 | With no priority, the message joins the turn at the next tool call. `"later"` waits for the turn to end, and `"now"` ends it early.  | An in-process MCP tool, or the output stream.                                                                                         | The message's `uuid`, which the output echoes as `user_message_uuid`, or an ID passed to the reply tool. |
| ACP mode (Cursor CLI)                                               | The `acp` command is hidden from `--help`, but documented.                                                                                | The review server starts `cursor-agent acp` and is its ACP client. No config files: it passes its MCP server in `session/new`.                                                           | `session/prompt` starts a turn.                                                                                                                       | A new `session/prompt` cancels the running turn, and kills its shell command.                                                        | The agent calls a reply tool on an MCP server the review server passes in, or the review server reads `session/update` notifications. | A message ID in the prompt, passed back to the reply tool, or the `session/prompt` request it answers.   |
| Remote Control (both agents)                                        | Claude Code: documented. Cursor CLI: none in the CLI.                                                                                     | None that a review server can use.                                                                                                                                                       | No way to send from a local program.                                                                                                                  | No way to send.                                                                                                                      | None.                                                                                                                                 | None.                                                                                                    |
| Codex CLI app-server and `codex queue` (docs only)                  | `codex queue` is stable. `app-server` and the queue methods are experimental.                                                             | None for a TUI started after 0.157, which runs on a shared background server.                                                                                                            | `codex queue` or `thread/queue/add` wakes an idle thread, and `turn/start` starts a turn.                                                             | Three choices: `turn/steer` adds to the running turn, `turn/interrupt` ends it, and the queue holds the message until the turn ends. | The agent's messages on the turn, or a tool on an MCP server the review server provides.                                              | `clientUserMessageId` on the message, and the turn ID.                                                   |
| OpenCode server (docs only)                                         | Documented, unversioned API.                                                                                                              | Start the TUI with `--port`. The docs say it always listens on a random port, but the v1.19.3 source only listens with `--port`.                                                         | `POST /session/:id/prompt_async`.                                                                                                                     | Not documented. In the source, the message joins the running turn at its next step.                                                  | Events on `GET /event`, or a plugin or MCP tool.                                                                                      | `messageID` in the request, and the reply's `parentID`.                                                  |
| ACP in general (docs only)                                          | v1 is stable, v2 is a draft.                                                                                                              | The client starts the agent over stdio.                                                                                                                                                  | Only the client starts a turn, with `session/prompt`.                                                                                                 | Not specified in v1 or v2.                                                                                                           | `session/update` notifications until the `session/prompt` response.                                                                   | The `session/prompt` request, and in v2 a `messageId`.                                                   |

### Claude Code channels

A channel is an MCP server, started by Claude Code over stdio, that declares the
`experimental['claude/channel']` capability and pushes messages into a running
agent session with `notifications/claude/channel {content, meta}`. The agent
answers through a tool the same server provides. Checked by hand with Claude
Code 2.1.306, Sonnet 5.5 and Haiku 5.5, in auto mode and in the default
permission mode. Prototype:
[`channels/`](0007-messaging-agent-sessions/channels/).

- **Stability and setup.** The docs call channels a research preview
  ([channels](https://code.claude.com/docs/en/channels),
  [channels reference](https://code.claude.com/docs/en/channels-reference)).
  - A custom channel server needs the agent session to start with
    `--dangerously-load-development-channels server:<name>`, which isn't in
    `claude --help`. Every launch shows a full-screen "Loading development
    channels" warning that the human must accept. The channel server doesn't
    start until they do. `--channels plugin:<name>@<marketplace>` skips the
    warning, but only for plugins on Anthropic's allowlist or an organization's
    `allowedChannelPlugins` (read in docs only).
  - It can't be added to an agent session that's already running. It's ignored
    with `-p` and the Agent SDK (read in docs only).
  - It needs a claude.ai or Console login, not Bedrock, Vertex, or Foundry, and
    Team and Enterprise organizations must turn on `channelsEnabled` (read in
    docs only). A Pro subscription worked.
  - The first launch in a directory also asks the human to approve the project
    `.mcp.json`. Nothing in `~/.claude/` had to change.
  - The
    [MCP docs](https://code.claude.com/docs/en/mcp#push-messages-with-channels)
    say a channel server that negotiates MCP protocol revision 2026-07-28 isn't
    registered as a channel, because that revision can't carry channel messages.
    `@modelcontextprotocol/sdk` 1.32.1 negotiates 2025-11-25, so it worked. A
    later SDK could stop the channel working without an error.
- **The reply tool is deferred.** Following the channels reference's "Expose a
  reply tool" as written, the agent received the message but answered in the
  terminal instead of calling the reply tool, for both models. Claude Code had
  deferred the tool behind tool search, so it wasn't in the model's tool list.
  Marking the tool with `_meta: {"anthropic/alwaysLoad": true}`, documented only
  in [the MCP docs](https://code.claude.com/docs/en/mcp), fixed it for every
  later message. The prototype sets it.
- **Addressing.** Claude Code starts one channel server per agent session, and
  the review server can't find agent sessions itself. In the prototype, each
  channel server connects out to the review server and reports what it knows:
  the `claude` process ID (its parent), its working directory,
  `CLAUDE_CODE_SESSION_ID`, and any variable the human set when starting
  `claude`. After `/clear` the agent session ID changes, but the channel server
  keeps reporting the old one. The connection and the process ID stay the same.
- **Idle.** The terminal shows `← review: <text>`, and a turn starts 110 to 125
  ms after the send. The reply came back 2.5 to 3.5 s after the send with
  Sonnet, and about 5 s with Haiku.
- **Busy.** The `← review:` line appears at once under the running tool call,
  and the message joins the same turn when that tool call ends. With a 30 s
  script running, the reply arrived 31 s after the send. Nothing was lost or
  interrupted. The docs say several messages that arrive while busy are
  delivered together.
- **Waiting on a permission prompt.** The `← review:` line appears above the
  prompt, and the prompt keeps focus. The message reaches the model after the
  human answers, in the same turn.
- **Permission relay.** A channel server that also declares
  `claude/channel/permission` receives each permission request, including a
  sub-agent's, about 0 to 30 ms after the dialog opens, with the tool name, a
  description, and a preview of the input. An `allow` or `deny` sent back closes
  the dialog in the terminal. A verdict sent to the wrong agent session was
  ignored. After one `deny` of the reply tool, Haiku stopped replying to later
  channel messages until `/clear`, and said in the terminal that it hadn't acted
  on them because its last reply was denied.
- **Exited.** Claude Code stops the channel server when it exits, and nothing is
  queued. A message the review server sends after that is lost unless the review
  server holds it. When the review server restarted, the channel server
  reconnected in about 1.5 s.
- **Many agent sessions.** Two agent sessions in the same directory each started
  their own channel server, each got its own message, and each reply came back
  with the right ID. Messages reach only the main agent: a sub-agent has the
  reply tool but never gets channel messages, and the review server can't
  address it.
- **What the human sees.** The warning at every launch, a banner saying channel
  messages "inject directly in this session", then a `← review: <text>` line for
  each message and `Called review` for the reply. The reply's text isn't shown.
  Half-typed text in the input box stays and isn't submitted. But in the default
  permission mode the reply tool asks for approval, and that dialog replaces the
  input box, so keys the human types next answer the dialog.
- **Security.** Claude Code doesn't check who sent a message. The channel server
  and the review server must authenticate each other: the prototype doesn't, so
  any local process that can reach its port can prompt the agent and, through
  the permission relay, approve its tool calls. The message arrives in the
  model's context as a user message wrapped in `<channel source="review">`, so
  reviewer text becomes instructions to the agent. Permission prompts and auto
  mode's classifier still apply to what the agent then does.
- **Latency.** Send to turn start about 0.1 s. Send to reply 2.5 to 5 s idle. An
  `allow` verdict to reply received 31 to 47 ms.

### Standard MCP notifications

A project-scoped MCP server sends standard MCP notifications and requests while
the agent session is idle: `notifications/message` (logging),
`notifications/tools/list_changed` with a new tool whose description holds the
message, `prompts/list_changed`, `resources/list_changed`, `resources/updated`,
`sampling/createMessage`, and `elicitation/create`. Checked by hand with both
agents. Prototype:
[`mcp-notifications/`](0007-messaging-agent-sessions/mcp-notifications/).

- **Claude Code.** None of them started a turn or reached the model.
  - Logging messages are dropped, with nothing in the terminal.
  - The `list_changed` notifications make Claude Code fetch the list again,
    within 6 ms over stdio and 45 to 75 ms over HTTP. The model sees a new
    tool's name at its next turn, but not its description, because MCP tools are
    deferred behind tool search.
  - Claude Code never subscribes to resources, so `resources/updated` does
    nothing.
  - It doesn't declare `sampling`, and rejects `sampling/createMessage` with
    "Method not found".
  - `elicitation/create` opens a dialog for the human even while idle, which
    replaces the input box. The answer goes back to the MCP server. The model
    never sees it.
  - Progress notifications during a tool call show to the human under the
    running call, but not to the model.
- **Cursor CLI.** None of them started a turn or reached the model, and the
  terminal showed nothing.
  - It didn't fetch the tool, prompt, or resource lists again after
    `list_changed`.
  - It ignored logging messages, `resources/updated`, and
    `notifications/claude/channel` from a server that declared
    `experimental["claude/channel"]`.
  - It rejected `sampling/createMessage` with "Method not found", and declined
    `elicitation/create` in 41 ms without showing anything.
  - It only read `.cursor/mcp.json` at the root of the git repository, so the
    prototype ran from a copy outside git.
  - Its sandbox ran the stdio MCP server where connections from outside were
    refused, so the prototype used MCP over HTTP instead.
- **Addressing.** Each agent session has its own MCP connection, so a server can
  send to one agent session, but nothing it sends reaches the model.
- **What the human sees.** Nothing, except Claude Code's elicitation dialog and
  progress lines.
- **Security.** No message reaches the model, so there's nothing to inject. An
  elicitation dialog asks the human directly.
- **Latency.** Claude Code fetched a changed list within 6 to 75 ms, and the
  Cursor CLI rejected sampling in 17 ms and declined elicitation in 41 ms.
- **Sources.** The MCP traffic and the terminal, checked by hand.
  [Cursor's MCP docs](https://cursor.com/docs/mcp) list tools, prompts,
  resources, roots, and elicitation, with nothing that starts a turn.

### An MCP tool call that waits for a message

The agent calls a tool on the review server's MCP server, such as
`wait_for_message`, that blocks until the review server has a message, and
returns it. The agent replies through a second tool, such as `reply`, with the
message's ID. Prototype:
[`mcp-tool-wait/`](0007-messaging-agent-sessions/mcp-tool-wait/).

- **Claude Code.** Works, checked by hand in the default permission mode.
  - The
    [MCP docs](https://code.claude.com/docs/en/mcp#automatic-backgrounding-of-long-tool-calls)
    say a tool call in the main conversation that's still running after 2
    minutes moves to a background task, and its result arrives as a task
    notification. `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS` changes the 2 minutes,
    and `0` turns it off. Calls from sub-agents, and calls in print mode, don't
    move to the background.
  - Observed: at 120 s the agent got a tool result saying the call was moved to
    the background, and its turn ended. When the message arrived later, the
    agent session started a turn on its own 132 ms after the send, with the
    message in a `<task-notification>`, and called `reply` with the right ID.
    The terminal showed "MCP task … completed".
  - Busy: the task notification joined the running turn when its tool call
    ended. The agent replied, then finished the human's task.
  - Waiting on a permission prompt: the message reached the waiting call at
    once, and the prompt didn't change. When the human approved, the task
    notification reached the model in the same turn, after the command's result,
    and the reply came 37.8 s after the send, mostly waiting on the human. When
    the human chose "No", the turn ended, and the notification started a new
    turn. Reply after 25.4 s.
  - The agent has to call the tool to start waiting, and call it again after
    each message. A message that arrives when no call is waiting has to be held
    by the review server.
  - Limits, from the docs: a call fails after the server sends no response or
    progress notification for 30 minutes over stdio or 5 minutes over HTTP
    (`CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT`), so the server sends progress
    notifications to keep it open. The wall-clock limit is about 28 hours by
    default. A background call doesn't survive the agent session exiting.
  - In the default permission mode, each `wait_for_message` and `reply` call
    asked the human for approval.
- **Cursor CLI.** Doesn't work for an idle agent session, checked by hand with
  2026.10.19-6bbf2c4, partly with `--force` to skip the permission prompts.
  - A short wait works: a message sent 10 s into the call returned at once, and
    the agent called `reply` with the right ID.
  - Every MCP tool call times out after 60 s. Cursor sends
    `notifications/cancelled` and the model gets "MCP error -32001: Request
    timed out". Cursor sends no `progressToken`, and progress notifications
    didn't extend the call. Nothing moves the call to the background. The
    [CLI's MCP docs](https://cursor.com/docs/cli/mcp) don't mention a timeout. A
    [Cursor forum thread](https://forum.cursor.com/t/agent-acp-mcp-tools-call-times-out-at-60s-with-no-way-to-configure-it/163925)
    reports the same 60 s limit, with no setting.
  - A message sent after the turn ended waited on the review server, and nothing
    happened for 67 s. It was delivered on the next call.
  - Busy: Cursor ran the waiting call alongside a 30 s script, and the call got
    the message at once, but the model only saw it after the script ended.
  - In the default mode Cursor asks before every MCP tool call. `--approve-mcps`
    only approves the server, not its tools.
  - While the call waits, the terminal shows a "Calling" spinner, and the input
    box takes a follow-up.
- **Addressing.** Each agent session starts its own stdio MCP server, or opens
  its own MCP connection over HTTP, so the review server knows the connection
  but not which agent session it belongs to, unless the agent or the human
  passes an ID. Sub-agents share their parent's MCP servers.
- **Security.** As for channels: the MCP server must authenticate whoever sends
  messages, and the message text reaches the model as a tool result, which makes
  it a prompt injection path.
- **What the human sees.** In Claude Code, the waiting call moves to the status
  line as `1 MCP task`, and when the message arrives the terminal shows
  `● MCP task … completed`, then the reply. A suggested prompt in the input box
  was left alone. In the Cursor CLI, a `Calling` spinner shows while the call
  waits.
- **Latency.** With a short wait, send to the model asking to call `reply` was
  about 6 s, mostly the permission prompt. From the background, send to turn
  start was 132 ms.

### Messaging between agent sessions

Claude Code lets agent sessions send each other messages with the `SendMessage`
tool. Each interactive agent session listens on an inbox socket, and the
[cross-session messaging docs](https://code.claude.com/docs/en/cross-session-messaging)
describe a script posting into it. The review server, a process that isn't a
child of the agent session, writes a message to the socket, and the agent
replies with `SendMessage` to a socket the review server listens on, or by
running `curl`. Checked by hand with Claude Code 2.1.306 and Haiku 5.5.
Prototype:
[`cross-session-messaging/`](0007-messaging-agent-sessions/cross-session-messaging/).

- **Stability.** Documented, and on by default since 2.1.224. But the docs only
  give the authentication line, `{"type":"auth","token":"..."}`. The message
  format, the socket's location, the reply address rule, and the receipts were
  read in the 2.1.306 binary and confirmed by the runs, so they can change in
  any release:
  - The socket is `${XDG_RUNTIME_DIR}/cc-socks/<pid>.sock`, mode 0600 in a 0700
    directory. `~/.claude/sessions/<pid>.json` holds its path, the agent session
    ID, and its status.
  - A message is one line of JSON:
    `{"msgV":1,"msg_id":"<uuid>","type":"user","message":{"role":"user","content":"<text>"},"priority":"next","from":"uds:<reply socket>"}`.
    An optional `session_id` must match the agent session's ID, or the message
    is dropped, which guards against a reused process ID.
  - The agent session only accepts a `from` reply address in the same directory
    as its own socket, so the review server binds its reply socket there.
- **Setup.** Nothing in the agent session. `--bare` agent sessions don't listen
  on an inbox socket.
  [`claude agents --json`](https://code.claude.com/docs/en/agent-view#read-session-state-from-a-script)
  is the documented way to list agent sessions, with their process ID, agent
  session ID, working directory, and status, but not the socket's path.
- **Who can send.** On Linux, any process running as the same user, with no
  token. The token is only checked on Windows, and on macOS in some cases.
  - The docs' default rules deliver a message to an agent session in a prompting
    permission mode. A `bypassPermissions` agent session holds it in a dialog,
    with Deny selected, until the human answers or 5 minutes pass. But the
    sender's mode is taken from a `from-mode` attribute in the message text: a
    message claiming `from-mode="bypass"` got past the hold.
  - `crossSessionInbound` overrides the rules. `accept` in the project's
    `.claude/settings.json` was ignored, as the
    [settings reference](https://code.claude.com/docs/en/settings-reference#crosssessioninbound)
    says. `accept` passed with `--settings` at startup worked. `refuse` in the
    project's settings was picked up by running agent sessions without a
    restart.
- **Idle.** A turn started, and the reply arrived 2.0 to 6.0 s after the send.
  The first reply also loaded `SendMessage` through tool search.
- **Busy.** The message showed at once under the running 30 s script, and the
  agent read it when the script ended, in the same turn, without interrupting
  it. `"priority": "now"` didn't interrupt it either. Reply after 31.7 s.
- **Waiting on a permission prompt.** The message showed above the prompt and
  waited, and didn't answer the prompt. The reply came about 3 s after the human
  approved. When the human pressed Esc instead, the message started a new turn.
- **Exited.** After `/exit` a send fails at once with `ENOENT`. After the
  process was killed, the socket file stayed and a send failed with
  `ECONNREFUSED`. Nothing is queued.
- **Receipts.** The agent session sends the reply address a status when a
  message is held, then delivered, denied, expired, or refused. A message
  delivered normally gets no receipt.
- **Tying the reply to the message.** A reply carries no field that points to
  the message it answers. The review server put an ID in the text, and the agent
  copied it into its reply in every case.
- **Many agent sessions.** Two agent sessions each replied with their own ID. A
  sub-agent can `SendMessage` to the review server, and its agent ID shows in
  the text. It can't be addressed from outside: a message sent while it ran went
  to the main agent.
- **What the human sees.** A plain message shows like a submitted prompt,
  `❯ Another Claude session sent a message: …`. A message wrapped in a
  `<cross-session-message>` tag shows as a one-line preview,
  `› Message from @<name>: …`. Then the `SendMessage` call and the agent's text.
  A draft in the input box stays. In a `bypassPermissions` agent session, a held
  message opens a dialog that blocks the input until it's answered.
- **Security.** Any process running as the same user can prompt any of the
  user's agent sessions, and claim the bypass mode. The model is told the
  message came from another agent session, not the user, and can't approve
  prompts, and permission prompts still apply. The reply socket is in a shared
  directory, so any same-user process could also write to it, and the review
  server can't check who wrote, because Node's `net` doesn't expose the peer's
  credentials.

### A background process the agent starts

The agent starts a long-running process in the background, a listener, that
connects to the review server and waits for messages. When the review server
sends one, the listener prints it, with the message ID and the command to reply
with, or prints it and exits. The agent replies with
`node client.mjs reply <id> <text>`, which goes back through the listener's Unix
socket or straight to the review server. Prototype:
[`background-process/`](0007-messaging-agent-sessions/background-process/). The
variants differ in how the agent learns that the listener printed something or
exited:

- **The Monitor tool (Claude Code).** Each line the command prints is an event
  for the agent. Works, checked by hand with Claude Code 2.1.306 and Haiku 5.5.
  - Documented in the
    [tools reference](https://code.claude.com/docs/en/tools-reference#monitor-tool).
    A watch the agent starts ends after its `timeout_ms`, 5 minutes by default
    and 30 at most, and the agent gets a notice and has to start it again.
    Messages sent in between have to be held by the review server. Monitor isn't
    available on Bedrock, Vertex, or Foundry, or with telemetry turned off (read
    in docs only).
  - **Idle.** Each line starts a turn. The terminal shows
    `● Monitor event: [agent-diff review message m3] …`, then the reply command.
    Reply 2.3 s after the send.
  - **Busy.** Nothing showed during a 30 s script. The event was handled right
    after it, in the same turn. Reply after 27.7 s.
  - **Waiting on a permission prompt.** The prompt didn't change. The event was
    handled after the human approved, in the same turn.
  - **Exited.** `/exit` asks whether to stop the background tasks, move the
    agent session to the background, or stay. Stopping them closed the listener
    at once. Messages sent afterwards stay queued on the review server, which
    can't tell whether the agent session will come back.
  - A plugin can declare monitors in `monitors/monitors.json` that start with
    the agent session and run for its whole life, with no timeout
    ([plugin components](https://code.claude.com/docs/en/plugins/components#monitors)),
    so the human doesn't have to ask the agent to start one. The prototype has
    one in `plugin/`, loaded with `--plugin-dir`. The review server's log from a
    run whose screen wasn't recorded shows two such listeners, each with its
    agent session's `CLAUDE_CODE_SESSION_ID`, each answering its own message.
    Not checked on screen.
- **A background command that exits when a message arrives.** Claude Code's Bash
  `run_in_background`, or the Cursor CLI's background shell commands.
  - **Claude Code.** Works, checked by hand. When the listener exited, an idle
    agent session started a turn, showing
    `● Background command "…" completed (exit code 0)`, read the command's
    output, and replied, 4.4 s after the send. The
    [docs](https://code.claude.com/docs/en/interactive-mode#how-backgrounding-works)
    only say that output goes to a file the agent reads. They don't say that the
    command ending starts a turn. The agent has to start the listener again
    after each message, and the review server holds messages until it does. The
    review server's log shows the busy and permission prompt cases handled after
    the tool call or the approval, but the screens weren't recorded. When the
    agent stopped a listener during its HTTP request, one message was lost,
    because the prototype counted it as delivered.
  - **Cursor CLI.** Works, checked by hand with 2026.10.19-6bbf2c4 in the
    default permission mode. Asked to run the listener "as a background shell
    command", the agent sets the Shell tool's `is_background` argument, read in
    the bundle. There's no flag for it.
    - **Idle.** When the listener exited, the terminal showed
      `Finished <description>`, and a turn started. The agent read the command's
      output file and replied, 17 and 29.7 s after the send. The bundle starts
      an "idle-enqueue" turn when a background task finishes, and the
      [CLI changelog](https://cursor.com/docs/cli/changelog) for 2026.08.11 says
      "Completion follow-ups for finished background tasks fire again". Neither
      is in the CLI docs.
    - **Busy.** The message was handled in the same turn, right after a 30 s
      script ended, 29.5 to 30.6 s after the send. That was the model's choice:
      the script's result carried no notice. Cursor's own notice then started a
      separate turn afterwards.
    - **Waiting on a permission prompt.** The prompt didn't change. The agent
      replied in the same turn, 3.4 s after the human chose "Run (once)".
    - **Exited.** Ctrl+D showed no dialog, and the listener was killed. Messages
      sent afterwards stay queued on the review server. The Cursor CLI's
      `worker-server` process was left running after each exit.
- **A background command that keeps printing.** Doesn't work in Claude Code,
  checked by hand: the listener printed the message, but nothing reached the
  agent for 45 s, and the review server counted it as delivered. Its output only
  goes to a file. In the Cursor CLI it doesn't work either on its own: in a run
  whose screen wasn't recorded, two printed messages were answered only after
  123 and 159 s. But a watched background shell does work, checked by hand:
- **A watched background shell (Cursor CLI).** Asked in plain words to run the
  listener as a background shell command "and ask to be notified whenever its
  output matches `agent-diff review message`", the agent set the Shell tool's
  `output_notification` with that pattern, read in the bundle. The
  [CLI changelog](https://cursor.com/docs/cli/changelog) for 2026.10.08
  describes "wakeups from watched background shells" for ACP clients. The CLI
  docs don't describe it.
  - **Idle.** Each matching line started a new turn, with
    `Finished Review message received` on screen, and the listener kept running,
    so it didn't need starting again. The notice the model gets says the pattern
    matched, but doesn't include the line, so the agent reads the output file.
    Replies 6.5 and 10.2 s after the send.
  - **Busy.** The message waited until the busy turn ended, then started a new
    turn. Reply after 58.4 s.
  - **Waiting on a permission prompt.** The screen didn't change while the
    prompt showed. After the human chose "Run (once)", that turn ended, and the
    match started a new turn. Reply 8.4 s after the approval, 27.8 s after the
    send.

For all of them:

- **Addressing.** The listener carries an ID it was started with, and the review
  server addresses messages by that ID. Many agent sessions can share one review
  server. The agent doesn't know its own agent session ID unless told, but
  `CLAUDE_CODE_SESSION_ID` is in a Claude Code monitor's environment. The docs
  say a background command or monitor started by a foreground sub-agent stops
  when the sub-agent finishes.
- **What the human sees.** One line per message, then the reply command and a
  summary. In Claude Code the line is `● Monitor event: …` or
  `● Background command … completed`, and the status line shows `1 monitor` or
  `1 shell`. In the Cursor CLI it is `Finished <description>`, and the status
  line shows `1 task`. The input box stays usable in both. Nothing shows during
  a busy tool call or a permission prompt until it ends.
- **Security.** The listener and the reply command run with the user's
  permissions, outside the sandbox for plugin monitors. The prototype has an
  optional bearer token, which the agent can read from the listener's
  environment. The message arrives as command output, and the line includes the
  reply command, which the agent ran as given, so a message can carry
  instructions. In auto mode the classifier checked each reply command.

### A prompt to a background agent session

A human starts the agent session in the background, with `claude --bg`, and can
attach a terminal to it. The review server sends a message with
`claude --resume <agent session ID> "<message>"`, which queues the message as
the agent session's next prompt. The agent replies by running a command the
message names, `node reply.mjs <id> <text>`, which posts to the review server.
Prototype:
[`background-agent-session/`](0007-messaging-agent-sessions/background-agent-session/).

- **Claude Code.** Works, checked by hand with Claude Code 2.1.306 and Haiku
  5.5.
  - **Stability.** Documented in
    [sessions](https://code.claude.com/docs/en/sessions#resume-a-running-background-session)
    since 2.1.285. Background agent sessions belong to
    [agent view](https://code.claude.com/docs/en/agent-view), a research
    preview.
  - **Setup.** The human starts the agent session with `claude --bg`, not as an
    ordinary interactive agent session. The reply command has to be allowed,
    such as in the project's `.claude/settings.json`, or the agent asks for
    permission.
  - **Sending.** `claude --resume` refuses to send when its input or output is
    piped, so the review server runs it in a pseudo-terminal with
    `script -q -e -c '...' /dev/null`. It waits for the line
    `Sent your prompt to the background session`, or `Your prompt was not sent`,
    then ends the command. That text is the only result: there's no exit status
    or machine-readable output to read, since the command goes on to attach to
    the agent session.
  - **Addressing.** `claude agents --json` lists background agent sessions with
    their agent session ID, name, working directory, process ID, and status, and
    the docs call it "the supported way to read session state from outside
    Claude Code". The review server can address an agent session by its ID or
    name. Sub-agents can't be addressed.
  - **Idle.** A turn started, and the reply came 4.1 to 5.4 s after the send.
    Starting `claude` to send took 3.0 to 3.4 s of that.
  - **Busy.** The message showed under the running 30 s script, and the human's
    input box said `Press up to edit queued messages`. It joined the same turn
    when the script ended, without interrupting it. Reply after 20.4 s.
  - **Waiting on a permission prompt.** The message was sent, and waited above
    the open dialog without answering it. It was handled in the same turn after
    the human approved. Reply 0.8 s after the approval. The docs say a prompt
    isn't sent while the agent session "waits on your answer to a question",
    which didn't include a permission prompt. A question from the agent wasn't
    tried.
  - **Exited.** After `claude stop`, `claude --resume <id> "<message>"` didn't
    send to the background. It continued the conversation in a new, ordinary
    interactive agent session inside the review server's pseudo-terminal and ran
    the message there, where no human sees it. The reply came after 7 s.
    Continuing the conversation in a new background agent session with `--bg`
    wasn't tried.
  - **Many agent sessions.** Two sends at once to two background agent sessions
    each started their own `claude` process, and each reply had its own ID.
  - **What the human sees.** A human attached with `claude attach` sees the
    message as an ordinary prompt,
    `❯ [agent-diff review server, message <id>] …`, and the agent's work. A
    half-typed prompt in their input box stays.
  - **Security.** Any process running as the same user can run `claude` and
    send. The message is a user prompt, with the user's authority. It's in the
    command's arguments, so other processes can see it in `ps` while it runs.
    The review server's pseudo-terminal briefly attaches as a full client.
- **Cursor CLI.** Doesn't work, checked by hand. `cursor-agent persist` keeps an
  agent session running in a tmux server that Cursor manages, and only has
  `list`, `attach`, and `stop`. It isn't in the
  [CLI docs](https://cursor.com/docs/cli).
  - `cursor-agent --resume <chatId> "<prompt>"` from another terminal asks
    whether to take over and disconnect the attached client. Answering `y`
    detaches the human's terminal and attaches the new one, but the prompt isn't
    sent.
  - `cursor-agent -p --resume <chatId>` is refused while the chat is held by
    `persist`.
  - So the only way in is typing into Cursor's tmux server.

### Print mode with `--resume`

The review server runs `claude -p --resume <agent session ID> "<message>"` or
`cursor-agent -p --resume <chatId> "<message>"` on the conversation of a running
interactive agent session, and reads the reply from the output. Prototype:
[`print-resume/`](0007-messaging-agent-sessions/print-resume/).

- **It doesn't reach the running agent session.** For both agents, checked by
  hand, print mode starts a second agent process that loads the stored
  conversation from disk, runs one turn, prints the reply, and exits. The reply
  is tied to the message because it's that process's output. The interactive
  agent session shows nothing, never starts a turn, and doesn't have the message
  or the reply in its context: asked to list every message it had received, it
  left them out.
  - **Claude Code.** Both processes append to the same transcript file, and the
    conversation splits into two branches from the same entry. A later
    `-p --resume` followed the print-mode branch, not the interactive agent
    session's newer one. The
    [sessions docs](https://code.claude.com/docs/en/sessions) say that resuming
    the same agent session in two terminals makes messages from both "interleave
    into one transcript", which is true of the file, but each process only sees
    its own branch.
  - **Cursor CLI.** The interactive agent session's next turn overwrote the
    chat, and the print-mode turn was gone from it.
- **Busy, or waiting on a permission prompt.** Checked by hand for Claude Code.
  The print-mode turn doesn't wait. It runs at once, treats the interactive
  agent session's running tool call as interrupted, and writes a made-up
  "interrupted" tool result into the shared transcript, next to the real one the
  interactive agent session writes later. The interactive agent session isn't
  disturbed. For the Cursor CLI, only the log of a run that stopped part way
  shows the same.
- **Exited.** Checked by hand for Claude Code. The print-mode turn is added to
  the conversation without a split, and when the human later runs
  `claude --resume`, the terminal shows the whole turn, including the review
  server's instructions. This is the only case where the message reaches the
  conversation the human uses. Not tried for the Cursor CLI.
- **Permissions.** Neither agent can ask a human in print mode. Claude Code
  starts it in the default permission mode, whatever the interactive agent
  session uses, and denies anything not allowed, such as the reply's `curl`,
  unless the review server passes `--allowedTools`. The Cursor CLI rejects shell
  commands unless `.cursor/cli.json` allows them or the review server passes
  `--force` ([permissions](https://cursor.com/docs/cli/reference/permissions)).
- **Addressing.** Claude Code: start the interactive agent session with
  `claude --session-id <uuid>`, and every print-mode result carries the same
  `session_id`. Cursor CLI: the chat ID is the directory name under
  `~/.cursor/chats/<md5 of the working directory>/`, which isn't documented, or
  the review server could create it first with `cursor-agent create-chat`, which
  wasn't tried.
- **Many agent sessions.** Two conversations ran in parallel, about 10 s each,
  with Claude Code. Each message costs a full agent startup.
- **Latency.** Send to reply 9 to 11 s with Claude Code and 17 to 23 s with the
  Cursor CLI, mostly startup.
- **Security.** Anyone who can run the agent as the same user and knows the
  conversation ID can do this. The message runs with whatever permissions the
  review server passes. Claude Code's `-p` skips the workspace trust dialog.

### An SDK that owns the agent session

The review server starts the agent itself through an SDK, and pushes user
messages into it at any time. Prototype:
[`sdk/`](0007-messaging-agent-sessions/sdk/).

- **Claude Code.** Works for agent sessions the review server starts, checked by
  hand with `@anthropic-ai/claude-agent-sdk` 0.3.306 and Haiku 5.5.
  - **How it works.** The review server calls `query()` with an async iterable
    as the prompt, and pushes a user message into it whenever it has one, with
    the message ID as its `uuid`. The SDK starts its own bundled `claude`
    2.1.306 with `--input-format stream-json --output-format stream-json`.
    Streaming input is the
    [documented, recommended mode](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode).
    It can't attach to an interactive agent session that's already running, but
    it can `resume` an earlier conversation.
  - **Login.** It used Dan's existing claude.ai login, with no API key. The
    [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
    says: "Unless previously approved, Anthropic does not allow third party
    developers to offer claude.ai login or rate limits for their products,
    including agents built on the Claude Agent SDK."
  - **Reply.** The agent called an in-process MCP tool,
    `reply(message_id, text)`, with the right ID every time. The output stream
    also ties each assistant message to the message it answers, with
    `user_message_uuid`, so the review server can tie replies without a tool.
    That field, the `priority` field, and `system/session_state_changed` events
    are in the SDK's type definitions, not on the streaming input docs page.
  - **Idle.** A turn starts when the message is pushed. The message was taken
    1.8 to 2.4 s after the send in a running agent session, and 5.5 to 7.8 s
    when the process had to start.
  - **Busy.** It depends on the message's `priority`, which isn't documented
    beyond its type:
    - None: the message joins the running turn at the next tool call boundary.
      Once, Haiku took it and never answered it.
    - `"later"`: it waits for the turn to end, then starts its own turn.
    - `"now"`: the running tool call still finished, then the turn ended early,
      and a new turn answered both messages.
  - **Waiting on a permission prompt.** Permission requests go to the review
    server's `canUseTool` callback, not to a human. A message with no priority
    waited until the request was answered, then joined the same turn. A `"now"`
    message cancelled the request at once, so the command didn't run, and
    started its own turn.
  - **Exited.** When the agent process was killed during a turn, the running
    turn and both queued messages were lost: the transcript has them only as
    queue entries. The killed agent's tool processes kept running. A message
    pushed afterwards stays in the review server's iterable with no error. A new
    `query()` that resumes the conversation continues it, without the lost
    messages, so the review server has to send again whatever wasn't taken.
  - **Addressing.** The review server holds each agent session's `query()`
    object, and pushes into the one it means. It knows the agent session ID from
    the stream, and can start a new `query()` that resumes it.
  - **Many agent sessions.** Two `query()` calls in one review server each ran
    their own `claude` process, and each reply had its own ID.
  - **What the human sees.** Nothing: there's no terminal. A human can open the
    same conversation with `claude --resume <id>`, with no warning, while the
    SDK holds it. They see it up to that moment, and can keep going, but the two
    processes then write separate branches of the conversation and don't see
    each other's turns.
  - **Security.** Whoever can push into the iterable is the agent session's
    user. The review server decides every permission request.
  - The same protocol without the SDK, `claude -p --input-format stream-json`,
    is in the prototype but wasn't run.
- **Cursor CLI.** Doesn't work with the CLI's login, checked by hand.
  `@cursor/sdk` 1.0.40 ([docs](https://cursor.com/docs/api/sdk/typescript)) runs
  a local agent with `agent.send()`, and `run.steer()` to add to a running turn.
  But it needs a Cursor API key, passed in code, in `CURSOR_API_KEY`, or created
  by `Cursor.auth.login()`. It doesn't use the CLI's login: without a key, runs
  failed with `Invalid User API Key`. No key was created.
  `cursor-agent -p --output-format stream-json` has no streaming input, so a
  print-mode process takes one prompt.

### ACP mode

In ACP mode the review server is the agent's client: it starts the agent as a
child process and talks JSON-RPC to it over stdio, the way an editor such as Zed
does. Prototype: [`acp/`](0007-messaging-agent-sessions/acp/), which uses raw
JSON-RPC with no dependencies.

- **Cursor CLI.** Works for agent sessions the review server starts, checked by
  hand.
  - `cursor-agent acp` is hidden from `cursor-agent --help`, but
    [documented](https://cursor.com/docs/cli/acp) for "building custom clients
    and integrations". It used the CLI's existing login, with no `authenticate`
    call, and didn't ask for workspace trust.
  - The review server sends `initialize`, then `session/new` with its own MCP
    server in `mcpServers`, including an `Authorization` header, so no config
    file is needed. Then it sends `session/prompt` with a message ID in the
    text. The agent called the MCP server's `reply` tool with the right ID every
    time. The review server can also read the reply from the
    `agent_message_chunk` updates before the `session/prompt` response.
  - **Idle.** The turn starts at once. The first update came 0.7 to 1.4 s after
    the send. The reply came 1.0 s after the send with Composer 2.5 Fast, and
    about 20 s with the default Auto model.
  - **Busy.** A second `session/prompt` cancels the running turn: the first
    prompt returns `stopReason: "cancelled"` 26 to 66 ms later, and its shell
    command is killed. Nothing queues. The bundle's `handlePrompt` cancels the
    pending prompt first (read in the bundle). The review server is the only
    client, so it knows when a turn is running, and would have to hold messages
    itself until it ends.
  - **Waiting on a permission prompt.** Permission requests go to the review
    server as `session/request_permission`, not to a human. A prompt sent while
    one is open cancels the turn and leaves the request open, so the client must
    answer it `cancelled` itself. The review server's own `reply` tool also
    asked for permission, because of Cursor's allowlist.
  - **Exited.** When the `cursor-agent acp` process died, an unanswered prompt
    was lost. A new process can `session/load` its conversation in about 3.8 s,
    which replays the completed turns.
  - **Addressing.** By the `sessionId` that `session/new` returned, on the
    process the review server started. `session/list` lists only ACP agent
    sessions.
  - **Many agent sessions.** Several `session/new` on one process each took
    about 1 s after the first, which took about 8 s with startup. Prompts to
    three of them ran in parallel, and each reply had the right ID.
  - **What the human sees.** Nothing in a terminal: ACP mode has no TUI, and
    only the client shows the conversation. ACP agent sessions are stored in
    `~/.cursor/acp-sessions/`, apart from the TUI's chats. `session/load` of a
    chat a human has open in the TUI fails with `Session "<id>" not found`, and
    `cursor-agent --resume` with an ACP agent session's ID starts a new, empty
    chat with that ID. So it can't reach an agent session a human started in the
    terminal.
  - **Security.** Only the parent process can write to the agent's stdin, and
    the agent listens on no port. The client decides every permission request,
    so whoever runs the review server can approve any tool call. Messages arrive
    as ordinary user prompts.
- **Claude Code.** Doesn't apply, read in docs only. `claude --help` has no ACP
  mode, checked by hand, and the
  [Claude Code docs index](https://code.claude.com/docs/llms.txt) doesn't
  mention ACP. The
  [ACP agents list](https://agentclientprotocol.com/overview/agents) has a
  "Claude Agent" entry through a third-party adapter,
  [`@agentclientprotocol/claude-agent-acp`](https://github.com/agentclientprotocol/claude-agent-acp)
  0.94.0, maintained in the `agentclientprotocol` GitHub organization by Zed
  developers, not by Anthropic. It wraps the Agent SDK, so it's the
  [SDK option](#an-sdk-that-owns-the-agent-session) behind ACP.
  - Its docs describe extensions for a client to add a prompt to a running turn
    or queue it, unlike Cursor's cancel.
  - [Zed's docs](https://zed.dev/docs/ai/external-agents) say it can use an API
    key or the Claude Code login. The
    [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
    says Anthropic doesn't allow third-party developers to offer claude.ai login
    for their products unless approved.
  - Nothing in its docs says a human can watch or type into the same agent
    session from a Claude Code terminal.

### Remote Control

Remote Control lets a remote service send prompts to an agent session running on
this machine. Prototype:
[`remote-control/`](0007-messaging-agent-sessions/remote-control/), which only
records what was run by hand, since there's nothing a review server can call.

- **Claude Code.** Doesn't work. `claude --remote-control` connected, and the
  terminal showed the claude.ai link and a `/rc` indicator. The process opened
  no local port: its only local socket is the inbox socket from
  [Messaging between agent sessions](#messaging-between-agent-sessions), and it
  reads its work from an `api.anthropic.com/v1/code/sessions/…` stream that
  isn't in the public API docs.
  [The Remote Control docs](https://code.claude.com/docs/en/remote-control) name
  only claude.ai, the Claude apps, claude.ai Projects, and Claude Code agent
  sessions on other machines as senders. Sending from a review server would mean
  calling that private API with Dan's account credentials, which wasn't tried.
  On `/exit`, the claude.ai side was archived.
- **Cursor CLI.** Doesn't work. The CLI has no `/remote-control`.
  [Cursor's Remote Control](https://cursor.com/docs/cloud-agent/mobile#remote-control)
  is only in the Cursor app's Agents Window, and moves the agent loop to
  Cursor's cloud. The
  [Cloud Agents API](https://cursor.com/docs/cloud-agent/api/endpoints), whose
  follow-up runs are rejected with `409 agent_busy` while one is active, and
  [My Machines](https://cursor.com/docs/cloud-agent/self-hosted-guides/my-machines)
  workers reach cloud agents whose tool calls run on this machine, never a local
  `cursor-agent` agent session. They'd also need a Cursor API key. Neither was
  tried.
- **Addressing, latency, and what the human sees.** There's no way for the
  review server to send, so none apply. A human using claude.ai sees the agent
  session's conversation there as it happens, according to the docs.
- **Security.** Only the account's own claude.ai clients and Claude Code agent
  sessions can send to a Claude Code agent session, and Cursor ties its Remote
  Control to the account and machine. A Cursor API key for the Cloud Agents API
  could start agents whose tool calls run on this machine.

### Codex CLI app-server and `codex queue`

Read in docs only, and in the source and pull requests where the docs say
nothing. The latest stable release was 0.163.0 (2026-10-15). Sources: the
[app-server docs](https://developers.openai.com/codex/app-server), the
[CLI reference](https://developers.openai.com/codex/cli/reference),
[non-interactive mode](https://developers.openai.com/codex/noninteractive),
[MCP](https://developers.openai.com/codex/mcp), and the `openai/codex` source at
`main` and its release notes for 0.149 to 0.163.

- **How it works.** Since 0.157, the interactive `codex` TUI runs as a client of
  a shared background app-server per user, reachable on a Unix socket at
  `$CODEX_HOME/app-server-control/app-server-control.sock` (source). Another
  process can connect to it as a client and address the same thread, Codex's
  name for an agent session's conversation, that the human is looking at.
  `codex queue --thread <id|name> --message <text>`, stable since 0.149, sends a
  message to a running agent session through the experimental `thread/queue/add`
  method. The release notes say queued messages "wake idle sessions".
- **Busy.** `turn/steer` adds the message to the running turn, `turn/interrupt`
  ends the turn, and the queue holds the message until the turn ends.
- **Waiting on approval.** Approvals are requests from the app-server to a
  client. The docs don't say which client gets them when the TUI and the review
  server both watch a thread.
- **Exited.** The app-server outlives the TUI. Queued messages are stored in
  SQLite and delivered when the thread is loaded or resumed.
- **Reply.** The agent's messages on the turn, ending with `turn/completed`,
  tied by `clientUserMessageId` and the turn ID. An MCP tool from the review
  server, configured in the project's `.codex/config.toml`, could give a
  structured reply.
- **Addressing.** By thread ID, or by name for `codex queue`. `thread/list` can
  filter by working directory and parent thread.
- **Security.** The socket is mode 0600 in a 0700 directory, with no token, so
  any process running as the same user can drive any thread, including running
  shell commands outside the sandbox. WebSocket listeners have optional token
  auth.
- **What the human sees.** Not documented. The TUI watches the same thread, so a
  turn another client starts should show live.
- **Latency.** Not measured.

### OpenCode server

Read in docs only, and in the v1.19.3 source where the docs say nothing.
Sources: the [server docs](https://opencode.ai/docs/server/), the
[SDK](https://opencode.ai/docs/sdk/),
[plugins](https://opencode.ai/docs/plugins/), the
[CLI](https://opencode.ai/docs/cli/), and the source at tag v1.19.3.

- **How it works.** The TUI is a client of an HTTP server.
  `POST /session/:id/prompt_async` sends a message to an agent session and
  starts a turn, and `GET /event` streams events, such as `message.updated` and
  `session.idle`. `/tui/append-prompt` and `/tui/submit-prompt` type into the
  human's prompt box over HTTP, which is close to typing into the terminal.
- **The docs and the source disagree.** The docs say the TUI "randomly assigns a
  port and hostname" for its server. In the v1.19.3 source, the TUI opens no
  HTTP listener unless it's started with `--port`, `--hostname`, or `--mdns`. So
  the human would have to start it with `--port`, or run `opencode serve` and
  `opencode attach`. Not checked by running it.
- **Busy.** Not documented. In the source, the message is saved and joins the
  running turn at its next step. `POST /session/:id/abort` interrupts.
- **Waiting on approval.** Any client can answer with
  `POST /session/:id/permissions/:permissionID`.
- **Reply.** The caller can set `messageID`, and the reply's `parentID` points
  at it. A plugin tool could give a structured reply.
- **Security.** HTTP basic auth only if `OPENCODE_SERVER_PASSWORD` is set.
  Without it, any local process can drive every agent session, including running
  shell commands.
- **Addressing.** By `host:port` and an agent session ID, listed by
  `GET /session`. The review server needs the port, and the password if one is
  set. Sub-agents' agent sessions have a `parentID`.
- **What the human sees.** Not documented. The TUI shows the agent session from
  the server's events, so a message sent over HTTP should show as a user message
  and its reply.
- **Latency.** Not measured.

### ACP in general

Read in docs only: the
[v1 protocol](https://agentclientprotocol.com/protocol/v1/overview),
[prompt turn](https://agentclientprotocol.com/protocol/v1/prompt-turn),
[session setup](https://agentclientprotocol.com/protocol/v1/session-setup), the
[v2 draft](https://agentclientprotocol.com/announcements/acp-v2-draft) and its
[prompt lifecycle](https://agentclientprotocol.com/protocol/v2/prompt-lifecycle),
and the RFDs for the
[HTTP transport](https://agentclientprotocol.com/rfds/streamable-http-websocket-transport)
and [proxy chains](https://agentclientprotocol.com/rfds/proxy-chains).

- In ACP an editor, the client, starts the agent over stdio and owns it. Only
  the client starts a turn, with `session/prompt`, and the reply is the
  `session/update` notifications until the response. v2, a draft since
  2026-07-20, lets the agent start work itself, such as after a background task
  ends, and returns a `messageId` for the prompt.
- Neither version says what happens to a prompt sent while a turn is running.
  `session/cancel` ends a turn.
- There's no way to attach a second client to a running agent session. An HTTP
  transport and proxies that could insert prompts are draft RFDs.
- So the review server could use ACP only as the client of an agent it starts
  itself, not to reach an agent session a human started in a terminal.
- **Addressing.** By the `sessionId` the client got from `session/new`, on the
  connection to the agent the client started. One connection can hold many agent
  sessions.
- **Security.** Over stdio, only the process that started the agent can send.
  ACP's `authenticate` covers the agent's own model login, not who may send
  prompts.
- **What the human sees.** Whatever the client shows. There's no terminal unless
  the client is one.
- **Latency.** Not measured.

### Changes to agent configuration during the research

- Passing `--model composer-2.5` to `cursor-agent` saved that model as the
  default in `~/.cursor/cli-config.json`. It was set back to the earlier
  default, Auto, afterwards.
- Choosing "allow always" in a Cursor permission prompt in ACP mode added
  `Mcp(agent-diff:reply)` to `~/.cursor/cli-config.json`, and choosing a model
  in ACP mode created `~/.cursor/acp-config.json`. Both were removed.
- The Cursor CLI updated itself during the research, from 2026.09.26-dd393fe to
  2026.10.19-6bbf2c4. Nothing in the research asked it to.
- Claude Code's settings, user MCP servers, plugins, and hooks didn't change.

### Prototypes

Each directory under
[`0007-messaging-agent-sessions/`](0007-messaging-agent-sessions/) has a
`README.md` with the steps to run it, and a `package.json` with exact versions.
None are workspaces of the root `package.json`. Run `npm install` in the
directory first when it has dependencies.

| Directory                                                                              | Option                                                                    | Agents checked                                                                                    | Dependencies                                                                |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| [`channels/`](0007-messaging-agent-sessions/channels/)                                 | Claude Code channels                                                      | Claude Code 2.1.306                                                                               | `@modelcontextprotocol/sdk` 1.32.1, `zod` 4.6.5                             |
| [`mcp-notifications/`](0007-messaging-agent-sessions/mcp-notifications/)               | Standard MCP notifications                                                | Claude Code 2.1.306, Cursor CLI 2026.10.19-6bbf2c4                                                | `@modelcontextprotocol/sdk` 1.32.1, `zod` 4.1.12                            |
| [`mcp-tool-wait/`](0007-messaging-agent-sessions/mcp-tool-wait/)                       | An MCP tool call that waits for a message, with a copy of the same server | Claude Code 2.1.306, Cursor CLI 2026.10.19-6bbf2c4                                                | `@modelcontextprotocol/sdk` 1.32.1, `zod` 4.1.12                            |
| [`cross-session-messaging/`](0007-messaging-agent-sessions/cross-session-messaging/)   | Messaging between agent sessions                                          | Claude Code 2.1.306                                                                               | None                                                                        |
| [`background-process/`](0007-messaging-agent-sessions/background-process/)             | A background process the agent starts                                     | Claude Code 2.1.306, Cursor CLI 2026.10.19-6bbf2c4                                                | None                                                                        |
| [`background-agent-session/`](0007-messaging-agent-sessions/background-agent-session/) | A prompt to a background agent session                                    | Claude Code 2.1.306, Cursor CLI 2026.10.19-6bbf2c4                                                | None                                                                        |
| [`print-resume/`](0007-messaging-agent-sessions/print-resume/)                         | Print mode with `--resume`                                                | Claude Code 2.1.306, Cursor CLI 2026.10.19-6bbf2c4                                                | None                                                                        |
| [`sdk/`](0007-messaging-agent-sessions/sdk/)                                           | An SDK that owns the agent session                                        | Claude Code 2.1.306 through `@anthropic-ai/claude-agent-sdk`, and `@cursor/sdk` up to the API key | `@anthropic-ai/claude-agent-sdk` 0.3.306, `@cursor/sdk` 1.0.40, `zod` 4.6.7 |
| [`acp/`](0007-messaging-agent-sessions/acp/)                                           | ACP mode                                                                  | Cursor CLI 2026.10.19-6bbf2c4                                                                     | None                                                                        |
| [`remote-control/`](0007-messaging-agent-sessions/remote-control/)                     | Remote Control                                                            | Claude Code 2.1.306, Cursor CLI 2026.09.26-dd393fe and 2026.10.19-6bbf2c4                         | None                                                                        |

## Options

The approaches found, with their benefits and costs. Each one also needs the
review server to hold messages for an agent session that isn't listening, and to
time out waiting for a reply, since replying is always up to the model.

### Claude Code channels

- **Benefits.**
  - Pushes a message into a running interactive agent session, and starts a turn
    when it's idle, about 0.1 s after the send.
  - Holds the message while the agent session is busy or waiting on a permission
    prompt, and never interrupts the running tool call.
  - The reply comes back through a tool, tied to the message by `meta`.
  - The permission relay can also show the agent session's permission prompts in
    the review UI and answer them.
  - The human sees each message in the terminal.
- **Costs.**
  - A research preview, and Claude Code only.
  - The human must start every agent session with
    `--dangerously-load-development-channels`, a hidden flag, and accept a
    warning every time, unless the channel is a plugin on Anthropic's allowlist.
    It can't be added to an agent session that's already running.
  - Following the docs as written, the agent didn't call the reply tool. It
    needed `alwaysLoad`, which the channels docs don't mention.
  - A later MCP SDK that negotiates protocol revision 2026-07-28 would stop
    registering as a channel, without an error.
  - Messages reach only the main agent, not its sub-agents.
  - Messages sent while the agent session isn't running are lost unless the
    review server holds them.
  - The review server and the channel server have to authenticate each other,
    since Claude Code doesn't check who sent a message.

### An MCP tool call that waits for a message

- **Benefits.**
  - Uses only standard MCP tools from a project MCP config, with no special
    flags.
  - In Claude Code, the documented move to the background after 2 minutes makes
    it wake an idle agent session when the message arrives.
- **Costs.**
  - The agent has to call the tool to start waiting, and again after each
    message.
  - Each call asks for permission unless the tool is allowed.
  - In Claude Code, calls from sub-agents and calls in print mode don't move to
    the background, and a waiting call ends when the agent session exits.
  - In the Cursor CLI, every MCP tool call times out after 60 s, with no
    setting, so it only works while the agent is in a turn.

### Messaging between agent sessions

- **Benefits.**
  - Works with any interactive Claude Code agent session that's already running,
    with no flags or config.
  - Starts a turn when idle, and waits for the running tool call or permission
    prompt when it isn't.
  - Documented and on by default.
- **Costs.**
  - Claude Code only.
  - The message format, the socket's location, and the reply address rule are
    only in the binary, and can change in any release.
  - On Linux there's no authentication: any process running as the user can
    prompt any of the user's agent sessions, and the check for agent sessions in
    the bypass mode relies on the sender's own claim.
  - The reply is tied to the message only by an ID the model copies into its
    text.
  - Sub-agents can't be addressed.

### A background process the agent starts

- **Benefits.**
  - Uses tools the agents already have, with no flags or config, so it works
    with an agent session that's already running, once the agent is asked to
    start the listener.
  - A Claude Code plugin monitor starts the listener with the agent session, and
    knows the agent session's ID.
  - The review server only needs an HTTP endpoint or socket the listener
    connects to.
  - It is the only option found that starts a turn in an interactive Cursor CLI
    agent session, and it works the same way in Claude Code.
- **Costs.**
  - Something has to ask the agent to start the listener, by a prompt, a skill,
    project instructions, or a plugin, and restart it after it ends: after each
    message when it exits, or after 30 minutes for a Monitor watch.
  - In Claude Code, a background command ending starts a turn, but the docs
    don't say it does. In the Cursor CLI, the same behaviour is internal.
  - Output from a command that keeps printing doesn't reach the agent unless
    it's a Claude Code Monitor watch or a Cursor CLI watched shell. The watched
    shell is only in the Cursor CLI's bundle and changelog, and it starts a new
    turn after a busy one rather than joining it.
  - The message arrives as command output, with the reply command in it.
  - When the agent session exits, the listener is stopped, and messages wait on
    the review server with no sign of whether the agent session will return.

### A prompt to a background agent session

- **Benefits.**
  - Documented in Claude Code. The message is an ordinary prompt that a human
    attached to the agent session sees, and it waits for the running tool call
    or permission prompt.
  - `claude agents --json` lists the agent sessions to send to.
- **Costs.**
  - Claude Code only. The human must start the agent session with `claude --bg`,
    part of agent view, a research preview.
  - The review server needs a pseudo-terminal, and reads the result from the
    command's text output. Each send starts `claude`, about 3 s.
  - A send to a stopped agent session runs the message in a new agent session in
    the review server's pseudo-terminal instead, where no human sees it.
  - The Cursor CLI's `persist` has no equivalent.

### An SDK or ACP client that owns the agent session

- **Benefits.**
  - The review server controls the agent session: it starts it, sends any number
    of messages, gets replies tied to message IDs in the protocol, and answers
    permission requests itself.
  - Many agent sessions can run from one review server.
  - Claude Code's Agent SDK has priorities for busy agent sessions, and Cursor's
    ACP mode uses the CLI's login.
- **Costs.**
  - There's no terminal for the human: the review server, or the review UI,
    would have to show the conversation and take the human's prompts, as a
    [harness](../glossary.md#harness) does. A human who opens the same
    conversation in a terminal gets a separate branch.
  - Anthropic doesn't allow third-party products to offer claude.ai login for
    Agent SDK agents unless approved, so other users would need an API key.
    `@cursor/sdk` needs a Cursor API key.
  - In Cursor's ACP mode, a prompt sent while a turn runs cancels it, so the
    review server has to hold messages until the turn ends.
  - When the process dies, queued and in-flight messages are lost.

### Print mode with `--resume`

- **Benefits.**
  - Works the same way in both agents, needs nothing from the human, and the
    reply is that process's output.
  - For an agent session that has exited, the message and reply become part of
    its conversation, which the human sees on `--resume`.
- **Costs.**
  - It doesn't reach the running agent session. While one runs, Claude Code
    splits the conversation in two, and the Cursor CLI loses the print-mode
    turn.
  - Neither agent can ask a human for permission in print mode.
  - Each message starts an agent, 9 to 23 s from send to reply.

### Remote Control

- **Costs.** No way for a local program to send, in either agent, without
  calling claude.ai's private API with the user's credentials.

### Other agents, read in docs only

- **Codex CLI.** `codex queue` and the shared app-server let another process
  send to a running interactive agent session, wake it when idle, add to or
  queue behind a running turn, and tie the reply with `clientUserMessageId`. The
  app-server and its queue methods are experimental, and the socket has no
  token.
- **OpenCode.** An HTTP API sends messages to a running agent session and
  streams events. The TUI only listens when started with `--port`, according to
  the source, not the docs. There's no authentication without a password.
- **ACP.** Only a client that started the agent can prompt it. No way to attach
  to an agent session a human started.

## Gaps

- **Checked by hand:** every option in the first table for Claude Code 2.1.306
  and the Cursor CLI 2026.10.19-6bbf2c4, except where a cell says otherwise,
  with the prototypes listed above. Busy and permission prompt cases were
  checked by hand for each option that works, except:
  - The background command that exits, in Claude Code: idle on screen, busy and
    permission prompt only in the review server's log.
  - Claude Code plugin monitors: only in the review server's log.
- **Read in docs only:** the Codex CLI, OpenCode, and ACP in general; Claude
  Code's ACP adapter; channel allowlists and organization settings; the Monitor
  tool's timeouts and provider limits; the Cloud Agents API and My Machines.
- **Read in the installed binary or bundle, not documented:** the inbox socket's
  message format, location, reply address rule, and receipts; the Cursor CLI's
  background shell arguments, `Await` tool, and the "idle-enqueue" turn; ACP
  mode's `handlePrompt` cancelling the running turn; the Cursor CLI's hidden
  `worker-server` routes.
- **Not tried:**
  - `@cursor/sdk` with a Cursor API key, since it doesn't use the CLI's login
    and the research had no other account or key.
  - `claude -p --input-format stream-json` without the SDK.
  - Print mode with `--resume` while the Cursor CLI's interactive agent session
    is busy, waiting on a permission prompt, or exited. A log from a run that
    stopped part way suggests the same as Claude Code for busy and permission
    prompts.
  - Calling claude.ai's private Remote Control API, or registering this machine
    as a Cursor worker.
  - A channel message to a main agent waiting in the foreground on a sub-agent,
    an inbox socket message with the token line, a held message's 5-minute
    expiry, a question from the agent, as opposed to a permission prompt, when a
    background agent session gets a prompt, and starting a stopped background
    agent session with `--bg`.
  - Several Cursor CLI agent sessions on one review server with a background
    process, and background processes started by sub-agents in either agent.
  - Standard MCP notifications while the agent session is busy or waiting on a
    permission prompt, since none reached the model when it was idle.
  - Whether the parent agent session's environment variables change any result
    when `claude` starts inside another Claude Code agent session.
- **Where the docs and what was observed differ:**
  - Following the channels reference's "Expose a reply tool" as written, the
    agent didn't call the reply tool, because Claude Code deferred it behind
    tool search. The fix, `alwaysLoad`, is only in the MCP docs.
  - Claude Code's sessions docs say two processes resuming the same conversation
    "interleave into one transcript". The lines do share one file, but as two
    branches, and each process sees only its own.
  - The [Cursor CLI's MCP docs](https://cursor.com/docs/cli/mcp) say it looks
    for MCP config in parent directories, but `.cursor/mcp.json` in a
    subdirectory of a git repository wasn't found. Not checked again.
  - Claude Code's docs say a background agent session doesn't get a prompt while
    it waits on an answer to a question. A permission prompt didn't stop it: the
    prompt was queued.
- **Couldn't be settled:**
  - OpenCode's docs say the TUI listens on a random port, and its source says it
    only listens with `--port`. Not run.
  - Which client gets the Codex CLI's approval requests when the TUI and another
    client watch the same thread. Not documented.
  - Which branch Claude Code shows on `--resume` after a conversation split.
    Once it showed the older branch.
- **Measurements.** Latencies come from one to three runs each, mostly with
  Haiku 5.5 or the Cursor CLI's default model, on one machine, so they show the
  order of magnitude, not a benchmark. The Claude subscription's usage limit
  stopped the hand testing twice, which is why some cases have fewer runs.
- **Versions.** The Cursor CLI updated itself during the research. The Remote
  Control, ACP, and print mode checks started on 2026.09.26-dd393fe and ended on
  2026.10.19-6bbf2c4. Everything after 04:35 UTC ran 2026.10.19-6bbf2c4.
