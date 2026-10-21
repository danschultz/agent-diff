# 0007: How can the review server send a message to a running agent session, and get a reply?

- Date: 2026-10-21

## Question

Dan asked for research into how the
[review server](../glossary.md#review-server) could send a message to a running
[agent session](../glossary.md#agent-session), and how the
[agent](../glossary.md#agent) could send a message back in reply, so he can
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
  `node -e "setTimeout(()=>{},30000)"`. Claude Code refused a plain `sleep 30`
  in the foreground. A permission prompt came from starting the agent session in
  its default permission mode and asking it to run a command that wasn't
  allowed.
- **Prototypes.** Each option has a prototype server in
  [`0007-messaging-agent-sessions/`](0007-messaging-agent-sessions/), one
  directory per option, listed in [Prototypes](#prototypes). Each one sends a
  message with an ID and logs the reply with that ID and the time since the
  send. Latencies below come from those logs, with timestamps.
- **Sources.** Every source was read on 2026-10-21. Claude Code docs at
  `code.claude.com/docs` describe 2.1.306. Cursor docs at `cursor.com/docs` are
  unversioned. Findings marked "read in the binary" come from strings in the
  installed Claude Code 2.1.306 binary or the Cursor CLI's bundled `index.js`,
  which are internals and can change in any release.

### Options at a glance

Each cell says whether the option works for that agent, checked by hand; doesn't
work, and where it stopped; or doesn't apply to that agent, and why.

| Option                                                                                  | Claude Code 2.1.306                                                                                                                                                            | Cursor CLI 2026.10.19-6bbf2c4                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Claude Code channels](#claude-code-channels)                                           | Works, checked by hand.                                                                                                                                                        | Doesn't apply: channels are a Claude Code feature. The Cursor CLI ignored a `notifications/claude/channel` notification, checked by hand under [Standard MCP notifications](#standard-mcp-notifications).                                      |
| [Standard MCP notifications](#standard-mcp-notifications)                               | Doesn't work: no notification or request started a turn or reached the model, checked by hand.                                                                                 | Doesn't work: no notification or request started a turn or reached the model, checked by hand.                                                                                                                                                 |
| [An MCP tool call that waits for a message](#an-mcp-tool-call-that-waits-for-a-message) | Works, checked by hand, because Claude Code moves a tool call that runs past 2 minutes to the background and wakes the agent when it ends.                                     | TODO(mcp-cursor)                                                                                                                                                                                                                               |
| [Messaging between agent sessions](#messaging-between-agent-sessions)                   | Works, checked by hand.                                                                                                                                                        | Doesn't apply: the Cursor CLI has no inbox for messages from other processes. Its hidden `worker-server` only serves indexing and file routes, read in the bundle.                                                                             |
| [A background process the agent starts](#a-background-process-the-agent-starts)         | TODO(bgproc-claude)                                                                                                                                                            | TODO(bgproc-cursor)                                                                                                                                                                                                                            |
| [A prompt to a background agent session](#a-prompt-to-a-background-agent-session)       | TODO(bgsession-claude)                                                                                                                                                         | Doesn't work: `cursor-agent persist` only lists, attaches, and stops agent sessions. `--resume <chatId> "prompt"` from another terminal offers to take over and disconnect the attached client, and `-p --resume` is refused, checked by hand. |
| [Print mode with `--resume`](#print-mode-with---resume)                                 | Doesn't work: it runs a separate process on the stored conversation, and the running agent session never sees the message, checked by hand.                                    | Doesn't work: as for Claude Code, and the next turn in the interactive agent session overwrote the print-mode turn, checked by hand.                                                                                                           |
| [An SDK that owns the agent session](#an-sdk-that-owns-the-agent-session)               | TODO(sdk-claude)                                                                                                                                                               | Doesn't work: `@cursor/sdk` 1.0.40 needs a Cursor API key, not the CLI's login, and runs failed with `Invalid User API Key`, checked by hand. `cursor-agent -p` has no streaming input.                                                        |
| [ACP mode](#acp-mode)                                                                   | Doesn't apply: Claude Code has no ACP mode. A third-party adapter wraps the Agent SDK, read in docs only.                                                                      | Works for agent sessions the review server starts with `cursor-agent acp`, checked by hand. It can't reach an agent session a human started in the terminal.                                                                                   |
| [Remote Control](#remote-control)                                                       | Doesn't work: only claude.ai, the Claude apps, and other Claude Code agent sessions can send. There's no API, local endpoint, or command for another program, checked by hand. | Doesn't work: the CLI has no Remote Control. Cursor's Remote Control, Cloud Agents API, and `worker` only reach cloud agents, checked by hand and in the docs.                                                                                 |
| [Codex CLI app-server and `codex queue`](#codex-cli-app-server-and-codex-queue)         | Doesn't apply: a Codex CLI feature, read in docs only.                                                                                                                         | Doesn't apply: a Codex CLI feature, read in docs only.                                                                                                                                                                                         |
| [OpenCode server](#opencode-server)                                                     | Doesn't apply: an OpenCode feature, read in docs only.                                                                                                                         | Doesn't apply: an OpenCode feature, read in docs only.                                                                                                                                                                                         |
| [ACP in general](#acp-in-general)                                                       | Doesn't apply: a protocol, read in docs only. See [ACP mode](#acp-mode) for the agents.                                                                                        | Doesn't apply: a protocol, read in docs only. See [ACP mode](#acp-mode) for the Cursor CLI.                                                                                                                                                    |

### How each option behaves

For the options that work, or that were only read in docs. Options that don't
work for either agent are left out.

| Option                                                  | Stability                                                                                              | Setup                                                                                                                                                                                    | Reaching an idle agent session                                                                                                               | When it's busy                                                                                                                       | How the reply comes back                                                                                                              | How the reply is tied to the message                                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Claude Code channels                                    | Research preview.                                                                                      | Start the agent session with the hidden `--dangerously-load-development-channels server:<name>` flag, and accept a warning every launch. A project `.mcp.json` names the channel server. | The channel server sends `notifications/claude/channel`, and a turn starts about 0.1 s later.                                                | The message waits, and joins the same turn when the running tool call ends.                                                          | The agent calls the channel server's reply tool.                                                                                      | A `message_id` in the notification's `meta`, which the agent passes back to the reply tool.            |
| An MCP tool call that waits for a message (Claude Code) | Documented.                                                                                            | A project MCP server with a tool that blocks until a message arrives. The agent has to call it, and call it again after each message.                                                    | After 2 minutes the call moves to the background. Its result arrives as a task notification that starts a turn, about 0.13 s after the send. | The task notification joins the same turn when the running tool call ends.                                                           | The agent calls a reply tool on the same MCP server.                                                                                  | The message ID in the tool result, passed back to the reply tool.                                      |
| Messaging between agent sessions (Claude Code)          | Documented and on by default, but the message format and the socket's location are only in the binary. | None in the agent session. The review server finds the socket in `~/.claude/sessions/<pid>.json`.                                                                                        | The review server writes one JSON line to the agent session's inbox socket, and a turn starts.                                               | The message is read between tool calls, without interrupting the running one.                                                        | The agent calls `SendMessage` to a socket the review server binds, or runs `curl`.                                                    | An ID in the message text, which the agent copies into its reply.                                      |
| A background process the agent starts                   | TODO                                                                                                   | TODO                                                                                                                                                                                     | TODO                                                                                                                                         | TODO                                                                                                                                 | TODO                                                                                                                                  | TODO                                                                                                   |
| A prompt to a background agent session (Claude Code)    | TODO                                                                                                   | TODO                                                                                                                                                                                     | TODO                                                                                                                                         | TODO                                                                                                                                 | TODO                                                                                                                                  | TODO                                                                                                   |
| An SDK that owns the agent session (Claude Code)        | TODO                                                                                                   | TODO                                                                                                                                                                                     | TODO                                                                                                                                         | TODO                                                                                                                                 | TODO                                                                                                                                  | TODO                                                                                                   |
| ACP mode (Cursor CLI)                                   | The `acp` command is hidden from `--help`, but documented.                                             | The review server starts `cursor-agent acp` and is its ACP client. No config files: it passes its MCP server in `session/new`.                                                           | `session/prompt` starts a turn.                                                                                                              | A new `session/prompt` cancels the running turn, and kills its shell command.                                                        | The agent calls a reply tool on an MCP server the review server passes in, or the review server reads `session/update` notifications. | A message ID in the prompt, passed back to the reply tool, or the `session/prompt` request it answers. |
| Codex CLI app-server and `codex queue` (docs only)      | `codex queue` is stable. `app-server` and the queue methods are experimental.                          | None for a TUI started after 0.157, which runs on a shared background server.                                                                                                            | `codex queue` or `thread/queue/add` wakes an idle thread, and `turn/start` starts a turn.                                                    | Three choices: `turn/steer` adds to the running turn, `turn/interrupt` ends it, and the queue holds the message until the turn ends. | The agent's messages on the turn, or a tool on an MCP server the review server provides.                                              | `clientUserMessageId` on the message, and the turn ID.                                                 |
| OpenCode server (docs only)                             | Documented, unversioned API.                                                                           | Start the TUI with `--port`. The docs say it always listens on a random port, but the v1.19.3 source only listens with `--port`.                                                         | `POST /session/:id/prompt_async`.                                                                                                            | Not documented. In the source, the message joins the running turn at its next step.                                                  | Events on `GET /event`, or a plugin or MCP tool.                                                                                      | `messageID` in the request, and the reply's `parentID`.                                                |
| ACP in general (docs only)                              | v1 is stable, v2 is a draft.                                                                           | The client starts the agent over stdio.                                                                                                                                                  | Only the client starts a turn, with `session/prompt`.                                                                                        | Not specified in v1 or v2.                                                                                                           | `session/update` notifications until the `session/prompt` response.                                                                   | The `session/prompt` request, and in v2 a `messageId`.                                                 |

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
- **Sources.** The MCP traffic and the terminal, checked by hand.
  [Cursor's MCP docs](https://cursor.com/docs/mcp) list tools, prompts,
  resources, roots, and elicitation, with nothing that starts a turn.

### An MCP tool call that waits for a message

The agent calls a tool on the review server's MCP server, such as
`wait_for_message`, that blocks until the review server has a message, and
returns it. The agent replies through a second tool, such as `reply`, with the
message's ID. Prototype:
[`mcp-notifications/`](0007-messaging-agent-sessions/mcp-notifications/).

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
- **Cursor CLI.** TODO(mcp-cursor)
- **Addressing.** Each agent session starts its own stdio MCP server, or opens
  its own MCP session over HTTP, so the review server knows the connection but
  not which agent session it belongs to, unless the agent or the human passes an
  ID. Sub-agents share their parent's MCP servers.
- **Security.** As for channels: the MCP server must authenticate whoever sends
  messages, and the message text reaches the model as a tool result, which makes
  it a prompt injection path.
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

TODO(bgproc)

### A prompt to a background agent session

TODO(bgsession)

### Print mode with `--resume`

TODO(printresume)

### An SDK that owns the agent session

TODO(sdk)

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
    was lost. A new process can `session/load` the agent session in about 3.8 s
    and replays its completed turns.
  - **Many agent sessions.** Several `session/new` on one process each took
    about 1 s after the first, which took about 8 s with startup. Prompts to
    three of them ran in parallel, and each reply had the right ID.
  - **What the human sees.** Nothing in a terminal: ACP mode has no TUI, and
    only the client shows the conversation. ACP agent sessions are stored in
    `~/.cursor/acp-sessions/`, apart from the TUI's chats. `session/load` of a
    chat a human has open in the TUI fails with `Session "<id>" not found`, and
    `cursor-agent --resume <ACP session ID>` starts a new, empty chat with that
    ID. So it can't reach an agent session a human started in the terminal.
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
| [`mcp-notifications/`](0007-messaging-agent-sessions/mcp-notifications/)               | Standard MCP notifications, and an MCP tool call that waits for a message | Claude Code 2.1.306, Cursor CLI 2026.10.19-6bbf2c4                                                | `@modelcontextprotocol/sdk` 1.32.1, `zod` 4.1.12                            |
| [`cross-session-messaging/`](0007-messaging-agent-sessions/cross-session-messaging/)   | Messaging between agent sessions                                          | Claude Code 2.1.306                                                                               | None                                                                        |
| [`background-process/`](0007-messaging-agent-sessions/background-process/)             | A background process the agent starts                                     | TODO                                                                                              | None                                                                        |
| [`background-agent-session/`](0007-messaging-agent-sessions/background-agent-session/) | A prompt to a background agent session                                    | TODO                                                                                              | None                                                                        |
| [`print-resume/`](0007-messaging-agent-sessions/print-resume/)                         | Print mode with `--resume`                                                | Claude Code 2.1.306, Cursor CLI 2026.10.19-6bbf2c4                                                | None                                                                        |
| [`sdk/`](0007-messaging-agent-sessions/sdk/)                                           | An SDK that owns the agent session                                        | Claude Code 2.1.306 through `@anthropic-ai/claude-agent-sdk`, and `@cursor/sdk` up to the API key | `@anthropic-ai/claude-agent-sdk` 0.3.306, `@cursor/sdk` 1.0.40, `zod` 4.6.7 |
| [`acp/`](0007-messaging-agent-sessions/acp/)                                           | ACP mode                                                                  | Cursor CLI 2026.10.19-6bbf2c4                                                                     | None                                                                        |
| [`remote-control/`](0007-messaging-agent-sessions/remote-control/)                     | Remote Control                                                            | Claude Code 2.1.306, Cursor CLI 2026.09.26-dd393fe and 2026.10.19-6bbf2c4                         | None                                                                        |

## Options

TODO

## Gaps

TODO
