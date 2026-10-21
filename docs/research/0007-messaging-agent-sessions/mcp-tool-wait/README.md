# An MCP tool call that waits for a message

Prototype for research 0007. A small review server that is also an MCP server.
The agent calls its `wait_for_message` tool, which blocks until the review
server has a message and returns it with its ID, and answers with the `reply`
tool, which takes the message ID.

The server is the same one as in
[`../mcp-notifications/`](../mcp-notifications/), which also has the standard
MCP notifications. This directory covers only the tool call that waits.

## Run it

1. `npm install` in this directory.
2. Start an agent session in this directory with one of the configs:
   - Claude Code, stdio (Claude Code starts the server):
     `claude --mcp-config mcp-stdio.json --strict-mcp-config`. Claude Code moves
     a tool call that's still running after 120 seconds to the background. To
     wait less, start it with `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS=15000`.
   - Cursor CLI, HTTP: first `node server.mjs --transport=http --port=47102`,
     then `cursor-agent --approve-mcps` with `.cursor/mcp.json`. The Cursor CLI
     only reads `.cursor/mcp.json` at the workspace root (the git root), so copy
     this directory to a scratch directory outside git and run it there. Don't
     use stdio with the Cursor CLI: it runs stdio MCP servers in its sandbox,
     where the control port isn't reachable from outside.
3. Ask the agent: "Call the review wait_for_message tool. When it returns a
   message, answer it with the review reply tool."
4. Send a message, on port 47112 for the stdio server or 47102 for the HTTP
   server:

   ```sh
   curl -s -X POST http://127.0.0.1:47112/control/send \
     -H 'content-type: application/json' \
     -d '{"kind":"poll","text":"What is the capital of France?"}'
   ```

5. The reply is logged as `REPLY` with the message ID and the latency, to
   `$AD_LOG`, by default `/tmp/ad-mcpnotif-<transport>.log`.
   `GET /control/status` lists the connected MCP connections.

What to expect:

- Claude Code: when the call has moved to the background and the turn has ended,
  the message arrives as a background task notification, which starts a turn in
  the idle agent session.
- Cursor CLI: every MCP tool call times out after 60 seconds. A message sent
  while no call is waiting stays on the review server until the agent calls the
  tool again.

`wait_for_message` takes `timeout_seconds`, and `heartbeat_seconds` to send
progress notifications while it waits. `busy.sh 30` keeps an agent session busy
for 30 seconds without `sleep`.
