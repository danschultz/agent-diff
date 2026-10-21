# MCP notifications and server-to-client requests

Prototype for research 0007. A small review server that is also an MCP server.
It tries to reach an agent session with standard MCP messages
(`notifications/message`,
`notifications/{tools,prompts,resources}/list_changed`,
`notifications/resources/updated`, `notifications/progress`,
`sampling/createMessage`, `elicitation/create`, and the Claude Code specific
`notifications/claude/channel`), and offers a long-poll tool
(`wait_for_message`) and a `reply` tool that takes the message ID.

The research was stopped early. See the research notes for what was tried.

## Run it

1. `npm install` in this directory.
2. Start an agent session in this directory with one of the configs:
   - Claude Code, stdio (Claude Code starts the server):
     `claude --mcp-config mcp-stdio.json --strict-mcp-config`
   - Claude Code, HTTP: first `node server.mjs --transport=http --port=47102`,
     then `claude --mcp-config mcp-http.json --strict-mcp-config`
   - Cursor CLI, stdio: `cursor-agent --approve-mcps` with `.cursor/mcp.json`.
     The Cursor CLI only found this file when this directory was the workspace
     root outside the git repo, so copy the directory somewhere else first.
3. Send a message from the review server:

   ```sh
   curl -s -X POST http://127.0.0.1:47112/control/send \
     -H 'content-type: application/json' \
     -d '{"kind":"tool_list_changed","text":"Please say hello"}'
   ```

   Use port 47112 for the stdio server and 47102 for the HTTP server. `kind` is
   one of `log`, `tool_list_changed`, `prompt_list_changed`,
   `resource_list_changed`, `resource_updated`, `progress` (during a `slow_task`
   call), `sampling`, `elicitation`, `channel`, or `poll` (returned by a blocked
   `wait_for_message` call).

4. `GET /control/status` lists the connected MCP sessions and their client
   capabilities. Every JSON-RPC message, send, and reply is logged with a
   timestamp to `$AD_LOG`, by default `/tmp/ad-mcpnotif-<transport>.log`.

To try the long poll, ask the agent: "Call the review wait_for_message tool.
When it returns a message, answer it with the review reply tool." Then send a
`poll` message. The reply is logged as `REPLY` with the message ID and the
latency.
