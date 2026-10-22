# Agent SDK prototype

The review server owns Claude Code agent sessions and pushes messages into them,
through the Agent SDK's streaming input (`"kind": "sdk"`) or by running
`claude -p --input-format stream-json` itself (`"kind": "cli"`). Each message
gets an ID. The agent answers with the `mcp__review__reply` tool (SDK only), and
the server also ties assistant frames and results to the ID through
`user_message_uuid`. Every event is logged to stdout as a JSON line, including
`agent.rate_limit`, which shows the subscription's usage.

It uses the Claude login on the machine. Don't set `ANTHROPIC_API_KEY`. The
agent session gets only `HOME`, `PATH`, `TERM` and `LANG` from the server's
environment, so starting the server from inside another Claude Code agent
session is fine.

The `"kind": "sdk"` path was tried by hand. The `"kind": "cli"` path is
implemented but wasn't run, because the usage limit was reached first.

## Run it

1. `npm install`
2. `AD_TOKEN=devtoken npm start`. It listens on `127.0.0.1:47108`.
3. Start an agent session in an existing directory, such as one made with
   `mkdir -p /tmp/work`. The agent process starts with the first message.
   `allowedTools` skips the permission prompt for those tools. Leave it out to
   get prompts.

   ```sh
   curl -s -H 'Authorization: Bearer devtoken' -d '{"kind":"sdk","cwd":"/tmp/work","model":"haiku","allowedTools":["Bash"]}' http://127.0.0.1:47108/sessions
   ```

   It returns the agent session's `id`. The agent process starts on the first
   message. Pass `"resume": "<claudeSessionId>"` to continue an earlier
   conversation.

4. Send a message, optionally with `"priority": "now" | "next" | "later"`:

   ```sh
   curl -s -H 'Authorization: Bearer devtoken' -d '{"text":"What is 2+2?"}' http://127.0.0.1:47108/sessions/<id>/messages
   ```

5. Watch the log for `message.consumed`, `reply` and `turn.result` events with
   the message ID. `GET /messages/<messageId>` shows the replies.
6. To make the agent session busy, copy `busy.sh` into its `cwd` and ask it to
   run the script with the Bash tool. It runs for 30 seconds. Send another
   message while it runs.
7. Permission prompts show up as `permission.requested`, and in
   `GET /sessions/<id>`. Answer one with
   `POST /sessions/<id>/permissions/<requestId>` and `{"allow": true}`.
8. `POST /sessions/<id>/interrupt` interrupts an SDK agent session, and
   `DELETE /sessions/<id>` ends it.
9. To see the conversation as a human, run `claude --resume <claudeSessionId>`
   in a terminal in the same `cwd`. `GET /sessions/<id>` shows the
   `claudeSessionId`. The terminal shows the conversation as it was when it
   started, and doesn't show messages the server sends afterwards.
