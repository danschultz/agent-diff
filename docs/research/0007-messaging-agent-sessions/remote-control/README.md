# Remote control surfaces

This directory has no prototype server. Neither agent offers a documented way
for a local review server to send a message to a running agent session through
its remote control surface, so there was nothing to prototype. What follows is
what was run by hand on 2026-10-21, so it can be repeated.

- Claude Code: v2.1.306, signed in to a claude.ai Pro subscription.
- Cursor CLI: `cursor-agent` v2026.09.26-dd393fe, which updated itself to
  v2026.10.19-6bbf2c4 during the run. Both versions behaved the same.

## Claude Code Remote Control

1. Start a tmux server with a clean environment, so the agent session doesn't
   inherit the variables a parent Claude Code agent session sets, and start
   Claude Code in this directory with Remote Control on:

   ```sh
   env -i HOME=$HOME PATH=$PATH TERM=xterm-256color LANG=C.UTF-8 \
     tmux -L ad-remote new-session -d -s rc -x 200 -y 50 -c "$PWD" \
     "env -i HOME=$HOME PATH=$PATH TERM=xterm-256color LANG=C.UTF-8 \
       claude --remote-control ad-rc-proto --model haiku --debug-file /tmp/ad-rc-debug.log"
   ```

2. Answer the dialog about external `CLAUDE.md` imports. Either answer works.
3. `tmux -L ad-remote capture-pane -p -t rc` shows
   `/remote-control is active · Continue here, on your phone, or at https://claude.ai/code/session_…`
   and `/rc` in the footer.
4. Look for anything local a review server could send to:
   - `ss -lpnt` and `ss -lpnx` for the `claude` process show no TCP listener,
     only the cross-session messaging inbox socket in `/tmp/cc-socks/`, which
     isn't part of Remote Control.
   - `claude --help`, `claude remote-control --help` and `claude agents --json`
     have no command or field for sending a message to an agent session over
     Remote Control.
   - The debug log shows the agent session reading a server-sent events stream
     from `api.anthropic.com/v1/code/sessions/<id>/worker/events/stream`, an
     endpoint the Claude Platform API reference doesn't list.
5. Type `/remote-control` and press Enter to see the status panel, then Esc and
   `/exit`. The debug log shows the agent session archived on claude.ai on exit.
6. `tmux -L ad-remote kill-server`.

## Cursor CLI

1. `cursor-agent --help`, `cursor-agent worker --help`,
   `cursor-agent worker debug --help` and `cursor-agent persist --help`.
2. Start the TUI in tmux with the same clean environment, trust the directory,
   and type `/remote` without pressing Enter. The TUI suggests no
   `/remote-control` command. Cursor's Remote Control is only in the Cursor
   app's Agents Window.
3. `cursor-agent worker debug` prints a read-only preflight report. It doesn't
   register a worker. `cursor-agent worker start` registers this machine as a My
   Machines worker in the account, so it wasn't run.
4. The Cloud Agents API, including follow-ups with `POST /v1/agents/{id}/runs`,
   needs a Cursor API key. Its agents run their loop in Cursor's cloud and never
   reach a local `cursor-agent` TUI. No API key was created.
