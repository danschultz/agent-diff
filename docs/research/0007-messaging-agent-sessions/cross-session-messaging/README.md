# Claude Code cross-session messaging prototype

A prototype review server that sends a message with an ID to a running,
interactive Claude Code agent session through the agent session's inbox socket,
and logs the agent's reply tied to that ID.

Claude Code documents the inbox socket and its auth line, but not the rest of
the wire format. The frames this prototype sends and reads were taken from the
Claude Code v2.1.306 binary and checked by hand against it. They can change in
any release.

## How it works

- Each Claude Code agent session binds a Unix socket,
  `$XDG_RUNTIME_DIR/cc-socks/<pid>.sock`, and lists it as `messagingSocketPath`
  in `~/.claude/sessions/<pid>.json`.
- The review server finds the agent session with `claude agents --json`, reads
  the socket path from that file, and writes one JSON line to the socket:

  ```json
  {
    "msgV": 1,
    "msg_id": "<uuid>",
    "type": "user",
    "message": {
      "role": "user",
      "content": "<cross-session-message from=\"uds:<inbox>\" from-name=\"agent-diff\">\n[ad-1234abcd] text\n</cross-session-message>"
    },
    "priority": "next",
    "from": "uds:<inbox>"
  }
  ```

- `<inbox>` is a socket the review server binds in the same directory as the
  agent session's socket. The agent session only accepts a reply address in its
  own socket directory, or a `<pid>.sock` in one of Claude Code's default socket
  directories.
- The agent session starts a turn, or reads the message between tool calls if
  it's busy, and answers with its `SendMessage` tool to `uds:<inbox>`. The
  review server reads the answer from its inbox, as a frame of the same shape,
  and ties it to the message by the `ad-…` ID the agent copies into its answer.
- When the agent session holds a message, or later delivers, denies or refuses a
  held one, it sends a `peer_message_status` frame to `<inbox>` with the
  original `msg_id`. The review server logs it as a receipt. A message that's
  delivered straight away gets no receipt.
- `POST /reply` takes a reply over HTTP instead, for an agent session told to
  answer with `curl`.

## Run it

Use Node 24 or later. There are no dependencies.

1. Start the review server from this directory. `AGENT_CWD` limits which agent
   sessions it addresses to those started in or under that directory, and
   defaults to the current directory:

   ```sh
   node server.ts
   ```

   It listens on `127.0.0.1:47104` and logs one JSON line per event.

2. In another terminal, start Claude Code in this directory:

   ```sh
   claude
   ```

   Accept the folder trust dialog if it asks. Don't type anything else.

3. List the agent sessions the review server can see, and send one a message:

   ```sh
   curl -s localhost:47104/agents
   curl -s -XPOST localhost:47104/send \
     -d '{"wrap": true, "text": "What is 2+2? Answer in one word."}'
   ```

   Without `pid`, it sends to the last agent session listed. Pass `"pid": <pid>`
   to pick one.

4. Expect the agent session to show
   `› Message from @agent-diff: [ad-…] What is 2+2? …`, start a turn, and send
   `ad-… 4` with `SendMessage`. In auto mode the classifier allows the
   `SendMessage` call, and in the default mode it isn't prompted for. The review
   server logs a `reply` event with the ID and the time since it sent the
   message.

## Try the other cases

- **Busy:** type ``Run `node busy.mjs` with the Bash tool, then say done.`` in
  the agent session, and send a message while it runs. The agent session reads
  it after the 30 s tool call ends, in the same turn.
- **Permission prompt:** start Claude Code with
  `claude --permission-mode default`, ask it to run `touch /tmp/x`, and send a
  message while the prompt shows. The message waits until you answer the prompt.
- **Held for approval:** start Claude Code with
  `claude --permission-mode bypassPermissions`. A message shows an approval
  dialog, and the review server logs a `held` receipt, then `delivered` or
  `denied`. Send with `"fromMode": "bypass"`, or start Claude Code with
  `--settings '{"crossSessionInbound":"accept"}'`, and it's delivered without
  the dialog. To skip the bypass disclaimer without accepting it into your user
  settings, put `{"skipDangerousModePermissionPrompt": true}` in
  `.claude/settings.local.json` in this directory.
- **Refused:** put `{"crossSessionInbound": "refuse"}` in
  `.claude/settings.json` in this directory. Running agent sessions pick it up,
  and the review server logs an `expired` receipt with
  `status_detail: "refused"`.
- **Reply with curl:** ask in the message for
  `curl -s -XPOST http://127.0.0.1:47104/reply -d '{"id":"<ID>","text":"<answer>"}'`.
- **Exited:** after `/exit` the socket is gone and the send fails with `ENOENT`.
  After `kill -9` the socket stays and the send fails with `ECONNREFUSED`.

`POST /send` also takes:

- `priority`: `"next"` (default), `"now"` or `"later"`.
- `wrap`: wrap the text in a `<cross-session-message>` tag, the way
  `SendMessage` does. Without it, the agent session shows the text as a prompt
  from "another Claude session".
- `bare`: leave out the instructions telling the agent session how to answer.
- `fromMode`: claim a permission-mode class, `"bypass"` or `"prompting"`, in the
  tag.
- `token`: send `{"type":"auth","token":…}` first.
- `noFrom`: leave out the reply address.
- `sessionId`: the agent session's ID, from `GET /agents`. The agent session
  silently drops a frame whose ID doesn't match, which guards against a reused
  PID.

`GET /messages` lists the messages sent, with their receipts and replies.

Stop the review server with Ctrl+C. It removes its inbox socket.
