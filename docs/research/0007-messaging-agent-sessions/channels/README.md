# Claude Code channels prototype

A prototype review server sends a message with an ID to a running, interactive
Claude Code agent session through a
[channel](https://code.claude.com/docs/en/channels-reference), and the agent
answers by calling a `reply` tool with the same ID. Channels are a research
preview, so this needs Claude Code's development flag.

- `review-server.ts` is the prototype review server. It listens on
  `127.0.0.1:47101` and logs every event with a timestamp.
- `channel-server.ts` is the channel: an MCP server that Claude Code spawns over
  stdio, one per agent session. It declares the `claude/channel` and
  `claude/channel/permission` capabilities, holds an event stream open to the
  review server, turns each message into a `notifications/claude/channel` event,
  and gives the agent a `reply` tool that posts the answer back.
- `.mcp.json` registers `channel-server.ts` as the project MCP server `review`.

## Run it

1. Install the dependencies, in this directory:

   ```sh
   npm install
   ```

2. Start the review server, in this directory:

   ```sh
   node review-server.ts
   ```

3. In another terminal, in this directory, start Claude Code with the channel
   loaded. `AD_SESSION_LABEL` is optional and names the agent session in the
   review server's log, and `--model` is optional:

   ```sh
   AD_SESSION_LABEL=agent-a claude --model sonnet \
     --dangerously-load-development-channels server:review
   ```

   The first time, Claude Code asks whether to use the new MCP server `review`
   from `.mcp.json`: choose **Use this MCP server**. Every time, it warns that
   development channels are loading: choose **I am using this for local
   development**. The banner then says
   `Channels (experimental) messages from server:review inject directly in this session`,
   and the review server logs `session.connected`.

4. In a third terminal, send a message. With one agent session connected, `to`
   can be left out. Otherwise pass the `sid` or the label from `GET /sessions`:

   ```sh
   curl -s localhost:47101/sessions
   curl -s -XPOST localhost:47101/send -d '{"to":"agent-a","text":"What is the capital of France?"}'
   ```

   The response has the message ID, such as `{"message_id":"m1","sid":"s1"}`.
   The terminal shows `← review: What is the capital of France?`, the agent
   starts a turn, calls the `reply` tool, and the review server logs
   `reply.received` with the same `message_id` and the time since it was sent.

5. To try the permission relay, start Claude Code with
   `--permission-mode default` (or switch to manual mode with `Shift+Tab`), so
   the `reply` tool and shell commands need approval. Send a message. When the
   approval prompt opens in the terminal, the review server logs
   `permission.request` with a five-letter `request_id`. Answer it from the
   review server instead of the terminal, with `allow` or `deny`:

   ```sh
   curl -s -XPOST localhost:47101/verdict -d '{"to":"agent-a","request_id":"abcde","behavior":"allow"}'
   ```

The review server's endpoints:

| Endpoint                           | Called by          | What it does                                            |
| ---------------------------------- | ------------------ | ------------------------------------------------------- |
| `GET /sessions`                    | You                | Lists the connected agent sessions.                     |
| `POST /send`                       | You                | Sends `text` to the agent session `to`, with a new ID.  |
| `POST /verdict`                    | You                | Answers a permission request in the agent session `to`. |
| `GET /channel/connect`             | The channel server | Holds an event stream open for messages and verdicts.   |
| `POST /channel/info`               | The channel server | Reports its parent process, folder and variable names.  |
| `POST /channel/delivered`          | The channel server | Reports a message written to Claude Code.               |
| `POST /channel/reply`              | The channel server | Passes on the agent's reply, from the `reply` tool.     |
| `POST /channel/permission-request` | The channel server | Passes on a permission prompt.                          |

Nothing is authenticated, so anything on this machine that can reach the port
can send the agent session a prompt or approve a tool call. Only run it for a
test.

The `reply` tool sets `"anthropic/alwaysLoad": true` in its `_meta`, so Claude
Code loads it upfront instead of deferring it behind tool search. Without it,
Haiku and Sonnet answered channel messages in the terminal and didn't call the
tool. Set `AD_ALWAYS_LOAD=0` when starting Claude Code to see that.
