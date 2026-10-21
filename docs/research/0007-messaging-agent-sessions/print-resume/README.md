# Prototype: print mode with `--resume`

The prototype server sends a message to an agent session's conversation by
starting `claude -p --resume <session-id>` or
`cursor-agent -p --resume <chat-id>` with the message as the prompt. It reads
the reply from the process's `stream-json` output, and also accepts a reply the
agent sends back with `curl`, tied to the message by its ID. It has no
dependencies and runs on Node 24 or later.

## Run it

1. Start the server: `node server.mjs`. It listens on `127.0.0.1:47106` (set
   `PORT` to change it) and logs one JSON line per event to stdout.
2. Start an interactive agent session in a scratch directory, in its own
   terminal, and type a first prompt so the conversation is saved:
   - Claude Code: `claude --session-id <uuid>`. The server addresses the agent
     session by that UUID.
   - Cursor CLI: `cursor-agent`. The chat ID is the folder name under
     `~/.cursor/chats/<md5 of the working directory>/`. For the reply with
     `curl` to run in print mode, allow it in the scratch directory's
     `.cursor/cli.json`: `{"permissions":{"allow":["Shell(curl)"],"deny":[]}}`.
3. Send a message:

   ```sh
   curl -s -X POST http://127.0.0.1:47106/send -H 'content-type: application/json' \
     -d '{"agent":"claude","conversation":"<session-id>","cwd":"<scratch dir>",
          "text":"What is the codeword?","callback":true,
          "args":["--allowedTools","Bash(curl -s -X POST http://127.0.0.1:47106/reply *)"]}'
   ```

   Use `"agent":"cursor"` and the chat ID for the Cursor CLI, without `args`.
   With `"callback":false` the reply comes only from the output.

4. Expect `send`, `init`, `reply-from-callback` (when `callback` is true),
   `reply-from-output` and `exit` lines in the log, each with the message ID and
   the milliseconds since `send`. `GET /messages` lists them.

The message runs in a new process on the stored conversation. The interactive
agent session's terminal shows nothing, and the interactive agent session
doesn't see the message or the reply.
