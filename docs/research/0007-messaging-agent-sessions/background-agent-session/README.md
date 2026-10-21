# Background agent session prototype

Sends a message with an ID into a running Claude Code background agent session
with `claude --resume <session-id> "<prompt>"`, run in a pseudo-terminal made by
`script`, and logs the agent's reply. Tried with Claude Code v2.1.306. It has no
npm dependencies; it needs `claude`, `script` (util-linux) and Node 24 or later.

1. Start the prototype review server. It listens on `127.0.0.1:47107`.

   ```sh
   node server.mjs
   ```

2. In another terminal, in this directory, start a background agent session.
   `.claude/settings.json` here allows `node reply.mjs` and `sh busy.sh` without
   a permission prompt.

   ```sh
   claude --bg --model haiku --permission-mode default -n adbg-one 'Say hi in five words.'
   ```

   It prints a short ID, such as `bb88af4d`. To watch it as a human would, run
   `claude attach <id>`.

3. Send a message. `session` is the short ID, the session UUID or the name from
   `claude agents --json`.

   ```sh
   curl -s -X POST localhost:47107/send -d '{"session":"<id>","text":"What is 2+2? Answer only with the number."}'
   ```

   The server prints `SEND`, then `SEND-RESULT ... sent=true` when `claude`
   prints `Sent your prompt to the background session`, then kills the pty,
   which ends the attach that follows. The agent runs
   `node reply.mjs <message-id> "4"`, and the server prints
   `REPLY <message-id> after <ms>ms: 4`.

4. `curl -s localhost:47107/agents` shows `claude agents --json --all`.

5. Stop the agent session with `claude stop <id>`, then `claude rm <id>`.

`busy.sh` waits about 30 seconds in Node, to keep a turn busy for the busy test.
Claude Code blocks a foreground `sleep 30`, so it doesn't use `sleep`. Ask the
agent to run `sh busy.sh` in the foreground, then send a message.
