# Shared helpers for the 0008 prototypes. Sourced by run.sh; not run directly.
# Needs: claude 2.1.308, node 24+.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
W="${W:-$(cd "$HERE/../../../.." && pwd)}"
OPT="${OPT:?set OPT before sourcing lib.sh}"
N="${N:-1}"
NAME="${NAME:-ad8-$OPT-$N}"
SCRATCH="${SCRATCH:-$W/.claude/worktrees/$NAME}"
MODEL="${MODEL:-haiku}"
CODEWORD="${CODEWORD:-PLUM-$RANDOM}"
DAEMON_DIR="${DAEMON_DIR:-$HOME/.claude}"

log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }

# claude with implement's clean environment.
cclaude() {
  env -i HOME="$HOME" USER="$USER" PATH="$PATH" TERM=xterm-256color LANG=C.UTF-8 \
    XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-}" claude "$@"
}

# Fresh scratch dir (not a git repo), with a settings file whose hooks append to
# $SCRATCH/hooks.jsonl.
make_scratch() {
  rm -rf "$SCRATCH"; mkdir -p "$SCRATCH"
  local hook="$HERE/hook-log.mjs" ev cfg=""
  for ev in SessionStart UserPromptSubmit Notification Stop SessionEnd PreToolUse PostToolUse; do
    cfg+="\"$ev\":[{\"hooks\":[{\"type\":\"command\",\"command\":\"node '$hook' $ev\",\"timeout\":30}]}],"
  done
  echo "{\"hooks\":{${cfg%,}}}" > "$SCRATCH/settings.json"
}

FIRST_PROMPT() {
  cat <<EOP
Remember the codeword $CODEWORD. Do these in order: (1) start a background Bash command (run_in_background true) that runs for 15 minutes: node -e "setTimeout(()=>{},900000)". (2) write a file progress.txt in the current directory containing exactly: step 1 done. (3) End your turn with the single word ready.
EOP
}

# Start the throwaway agent session the way implement does, plus --model.
start_session() {
  local out
  out=$(cd "$SCRATCH" && cclaude --bg --remote-control "$NAME" --name "$NAME" \
    --permission-mode auto --settings "$SCRATCH/settings.json" --model "$MODEL" \
    "$(FIRST_PROMPT)" 2>&1) || true
  echo "$out" > "$SCRATCH/start.out"
  SHORT=$(cclaude agents --json | node "$HERE/jsontool.mjs" agent "$NAME" | node "$HERE/jsontool.mjs" get id)
  [ -n "$SHORT" ] || { echo "could not find agent session $NAME; start output:"; echo "$out"; return 1; }
  SID=$(cclaude agents --json | node "$HERE/jsontool.mjs" agent "$NAME" | node "$HERE/jsontool.mjs" get sessionId)
  log "started $NAME short=$SHORT session=$SID"
}

jt() { node "$HERE/jsontool.mjs" "$@"; }
agent_json() { cclaude agents --json --all | jt agent "$SHORT"; }
agent_state() { local s; s=$(agent_json | jt get state); echo "${s:-gone}"; }

# Idle = every UserPromptSubmit hook has a later Stop hook. (agents --json "state"
# is model-written text and sometimes stays "working" after the turn ended.)
turn_done() {
  local f="$SCRATCH/hooks.jsonl" p s
  [ -f "$f" ] || return 1
  p=$(grep -c UserPromptSubmit "$f"); s=$(grep -c '"event":"Stop"' "$f")
  [ "$p" -ge 1 ] && [ "$s" -ge "$p" ]
}
wait_idle() {
  local i
  for i in $(seq 1 90); do
    turn_done && { sleep 3; log "idle (Stop hook seen; agents state=$(agent_state))"; return 0; }
    sleep 3
  done
  log "timed out waiting for idle (state=$(agent_state))"; return 1
}

state_file() { echo "$HOME/.claude/jobs/$SHORT/state.json"; }
transcript() { ls "$HOME"/.claude/projects/*/"$1".jsonl 2>/dev/null | head -1; }

# Kill the worker with SIGKILL. Prints the pids.
kill_worker() {
  local pid rpid
  read -r pid rpid < <(jt worker "$SHORT" < "$DAEMON_DIR/daemon/roster.json")
  log "SIGKILL worker pid=$pid replPid=$rpid"
  kill -9 $pid $rpid 2>/dev/null
  for i in $(seq 1 30); do
    [ "$(cclaude agents --json | jt agent "$SHORT")" = null ] && { log "gone from claude agents --json"; return 0; }
    sleep 2
  done
  log "still listed after kill"; return 1
}

# Usage of the first assistant message after the last user prompt containing $2.
first_usage_after() { jt usage "$1" "$2"; }

CONTINUE_PROMPT() {
  cat <<'EOP'
Continue. Say the codeword I gave you earlier (write CODEWORD_IS=<word>, or CODEWORD_IS=unknown if you do not know it). Say whether the background Bash command you started is still running (write BG_RUNNING=yes or BG_RUNNING=no). Then create an empty file PR_OPENED in the current directory and end your turn.
EOP
}

wait_pr() {
  local i
  for i in $(seq 1 60); do
    [ -f "$SCRATCH/PR_OPENED" ] && { sleep 8; return 0; }
    sleep 4
  done
  return 1
}

# The background command outlives a SIGKILLed worker (it is reparented to init); kill the
# ones that run in $SCRATCH.
kill_orphans() {
  local p
  for p in $(pgrep -f 'setTimeout\(\(\)=>\{\},900000\)'); do
    [ "$(readlink /proc/$p/cwd 2>/dev/null)" = "$SCRATCH" ] && kill $p 2>/dev/null
  done
  return 0
}

cleanup_session() {
  cclaude stop "$SHORT" >/dev/null 2>&1; sleep 2; cclaude rm "$SHORT" >/dev/null 2>&1
}

# The daemon restarts a killed worker by itself when the agent session's "state" is
# "working" (even when its turn has ended and a background task is still running),
# and leaves it dead when the state is "done". The state is written by the agent
# session's summariser, so it varies between runs. Start until it is "done".
start_until_done() {
  local try
  for try in 1 2 3 4 5; do
    make_scratch; start_session || return 1
    wait_idle || return 1
    if [ "$(agent_state)" = done ]; then return 0; fi
    log "state is '$(agent_state)', not 'done': a killed worker would be restarted by the daemon; trying again"
    kill_orphans; cleanup_session; rm -rf "$SCRATCH"; CODEWORD="PLUM-$RANDOM"
  done
  return 1
}
