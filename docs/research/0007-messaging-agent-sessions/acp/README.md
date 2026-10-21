# ACP prototype: Cursor CLI

A prototype review server that runs `cursor-agent acp` as a child process and
acts as its Agent Client Protocol (ACP) client over stdio. It sends messages
with an ID to agent sessions with `session/prompt`, and reads the reply two
ways: the turn's streamed `session/update` text, and a `reply` tool on a small
MCP server it serves at `/mcp` and passes to the agent in `session/new`. It has
no dependencies and speaks raw JSON-RPC.

Tried with Cursor CLI 2026.10.19-6bbf2c4 and Node 26.

## Run it

1. Make a scratch workspace for the agent, such as `mkdir /tmp/acp-ws`. Don't
   point it at a repo you care about: the agent can edit files there.
2. Start the server from this folder:

   ```sh
   LOG_FILE=/tmp/acp-server.log node server.mjs /tmp/acp-ws
   ```

   It prints JSON log lines and `TOKEN=…`. Every HTTP call needs
   `Authorization: Bearer <token>`. Optional env: `PORT` (default 47109),
   `PERMISSIONS=ask|allow|reject` (default `ask`), `AGENT_BIN`.

3. Create an agent session. Pass `{"load":"<sessionId>"}` instead to load an
   earlier ACP agent session:

   ```sh
   T=<token>
   curl -s -H "Authorization: Bearer $T" -X POST localhost:47109/sessions -d '{}'
   ```

4. Send a message. The response has the message ID, such as `msg-1a2b3c4d`:

   ```sh
   curl -s -H "Authorization: Bearer $T" -X POST localhost:47109/messages \
     -d '{"sessionId":"<sessionId>","text":"Reply with the word mango."}'
   ```

5. The agent asks to use the `reply` tool. List and answer permission requests
   (use `allow-once`; `allow-always` writes to the user's global
   `~/.cursor/cli-config.json`):

   ```sh
   curl -s -H "Authorization: Bearer $T" localhost:47109/permissions
   curl -s -H "Authorization: Bearer $T" -X POST localhost:47109/permissions \
     -d '{"rpcId":0,"optionId":"allow-once"}'
   ```

6. Expect `tool_reply` (with the message ID) and `turn_end` lines in the log.
   `GET /messages` shows each message's status, stop reason, streamed reply and
   tool replies.

Other endpoints: `GET /sessions` (`session/list`), `POST /cancel`
(`{"sessionId"}`), and `POST /raw` (`{"method","params"}`) to send any ACP
request.

There's no terminal UI in ACP mode. A human only sees what an ACP client shows,
here the log.
