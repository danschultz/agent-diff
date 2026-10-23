#!/usr/bin/env bash
# Option interactive-resume: continue an agent session whose worker was killed
# the way Dan did by hand, with an interactive (not --bg) `claude --resume
# <session-id> --permission-mode auto --settings <file>` in a terminal. The
# terminal is a tmux server on its own socket; the prompt is typed with
# `tmux send-keys`.
#
# Usage: ./run.sh
# Environment: AD8_MODE=idle|midturn|stop|midturn-stop, AD8_KILL=repl|host, AD8_NOTES=<file>,
#   AD8_KEEP=1, AD8_TMUX_SOCKET (default ad8-interactive-resume). See ../common/lib.sh.
set -u
export AD8_OPTION=interactive-resume
source "$(dirname "$0")/../common/lib.sh"
SOCKET=${AD8_TMUX_SOCKET:-ad8-interactive-resume}
tm() { tmux -L "$SOCKET" "$@"; }
stops() { grep -c '"event":"Stop"' "$AD8_HOOKS" 2>/dev/null; }
pane() { tm capture-pane -p -t main 2>/dev/null; }

finish() {
  tm kill-server 2>/dev/null
  ad8_cleanup
}

ad8_setup || { finish; exit 1; }

n=$(stops)
say "starting an interactive claude in tmux (-L $SOCKET): claude --resume $AD8_SID --permission-mode auto --settings <file>"
tm new-session -d -s main -x 200 -y 50 -c "$AD8_SCRATCH" \
  "env -i HOME='$HOME' USER='${USER:-$(id -un)}' PATH='$PATH' TERM=xterm-256color LANG=C.UTF-8 XDG_RUNTIME_DIR='${XDG_RUNTIME_DIR:-/run/user/$(id -u)}' claude --resume '$AD8_SID' --permission-mode auto --settings '$AD8_SCRATCH/settings.json'; sleep 600"
ad8_wait 60 "the interactive prompt" bash -c "tmux -L '$SOCKET' capture-pane -p -t main | grep -qE '^[[:space:]]*(❯|>)'" || {
  say "pane at timeout:"
  pane | sed 's/^/    | /'
}
sleep 3
say "pane after start (last 12 lines):"
pane | grep -v '^[[:space:]]*$' | tail -12 | sed 's/^/    | /' | tee -a "${AD8_NOTES:-/dev/null}"
say "agents --json (active) now: $(ad8_mine --active | cut -f1,3,4,5 | tr '\t' ' ' | paste -sd';' -)"
say "agents --json (active), raw entries for the scratch directory:"
cc agents --json | node -e '
  const cwd = process.argv[1]; let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    for (const a of JSON.parse(s)) if (a.cwd === cwd) console.log("    | " + JSON.stringify({ ...a, sessionId: String(a.sessionId).slice(0, 8) }));
  });' "$AD8_SCRATCH" | tee -a "${AD8_NOTES:-/dev/null}"

# No --model is passed, as in Dan's hand-run command. Claude Code's default is
# Opus, so stop here if the resumed agent session didn't keep its model.
if pane | grep -qi 'opus'; then
  say "ABORT: the resumed agent session shows Opus; not sending a prompt"
  finish
  exit 1
fi
say "model shown in the header: $(pane | grep -oiE '(haiku|sonnet|opus|fable)[ 0-9.]*' | head -1)"

say "typing the prompt"
tm send-keys -t main -l "$AD8_CONTINUE_PROMPT"
sleep 1
tm send-keys -t main Enter
ad8_wait 180 "PR_OPENED and a Stop hook" bash -c "[[ -e '$AD8_SCRATCH/PR_OPENED' ]] && [[ \$(grep -c '\"event\":\"Stop\"' '$AD8_HOOKS') -gt $n ]]"
sleep 3
say "pane after the turn (last 25 lines):"
pane | grep -v '^[[:space:]]*$' | tail -25 | sed 's/^/    | /' | tee -a "${AD8_NOTES:-/dev/null}"
say "agents --json --all now (short, session, state, status, name):"
ad8_mine | awk -F'\t' '{ printf "    | %s %s %s %s %s\n", $1, $2, $3, $4, $5 }' | tee -a "${AD8_NOTES:-/dev/null}"
say "agents --json (active), raw entries for the scratch directory:"
cc agents --json | node -e '
  const cwd = process.argv[1]; let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    for (const a of JSON.parse(s)) if (a.cwd === cwd) console.log("    | " + JSON.stringify({ ...a, sessionId: String(a.sessionId).slice(0, 8) }));
  });' "$AD8_SCRATCH" | tee -a "${AD8_NOTES:-/dev/null}"
say "state.json of the original short id: bridgeSessionId present $(node "$AD8_COMMON/jobstate.mjs" "$AD8_SHORT" bridge), $([[ $(node "$AD8_COMMON/jobstate.mjs" "$AD8_SHORT" bridgehash) == "$AD8_BRIDGE0" ]] && echo same || echo different) as before; state $(node "$AD8_COMMON/jobstate.mjs" "$AD8_SHORT" field:state)"
ad8_report

# Claude Code may show a one-off "Teach auto mode about your environment?"
# dialog after the turn. Escape cancels it without changing any setting.
tm send-keys -t main Escape
sleep 1
say "exiting with /exit (the SessionEnd hook should fire)"
tm send-keys -t main -l "/exit"
sleep 1
tm send-keys -t main Enter
sleep 6
say "hooks since /exit:"
tail -n 2 "$AD8_HOOKS" | grep -o '"event":"[A-Za-z]*","session_id":"[0-9a-f]\{8\}\|"reason":"[a-z_]*"' | paste -sd' ' - | sed 's/^/    | /' | tee -a "${AD8_NOTES:-/dev/null}"
say "after /exit: agents --all: $(ad8_mine | cut -f1,3,4 | tr '\t' ' ' | paste -sd';' -); background command running: $(ad8_bg_running)"
finish
