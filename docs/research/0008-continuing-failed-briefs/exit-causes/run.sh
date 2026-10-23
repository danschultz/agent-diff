#!/bin/bash
# Usage: ./run.sh <case> [watch-seconds]
#
# Starts a throwaway `claude --bg` agent session (haiku, implement's flags) in a
# fresh scratch dir, applies one cause for the agent session to end or stop
# responding, then prints what daemon.log, state.json, timeline.jsonl, the
# transcript, `claude agents --json --all` and the hook log show. Cleans up
# afterwards (set KEEP=1 to keep the scratch dir).
#
# Cases: idle, stop, bgbash, monitor, subagent, kill-<SIG>-<pid|replPid>[-idle]
#        (SIG is KILL, TERM, HUP or INT), badmodel, exit-attach, exit-resume
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/lib.sh"
CASE=${1:?usage: run.sh <case> [watch-seconds]}
WATCH=${2:-}
trap cleanup EXIT

new_scratch "${CASE//[^a-zA-Z0-9]/}"
echo "case=$CASE scratch=$SCR"

CODE=PLUM-$RANDOM
watch() { # watch <total seconds> <interval>: snapshot every interval
  local total=$1 step=$2 t=0
  while [ $t -lt "$total" ]; do sleep "$step"; t=$((t+step)); snapshot "+${t}s"; done
}

case $CASE in
  idle)
    start_agent "Reply with exactly: $CODE"
    wait_state '^done$' 60; snapshot "turn ended"; watch "${WATCH:-90}" 30 ;;

  bgbash)
    start_agent "Remember the codeword $CODE. Start ONE background Bash command (run_in_background true): node -e \"setTimeout(()=>{require('fs').writeFileSync('bg_done.txt','x')},${DELAY:-75}000)\" . Do not wait for it or poll it. Reply 'started' and end your turn at once."
    wait_state '^done$' 90; snapshot "turn ended (bg command ~75s)"
    watch "${WATCH:-180}" 30 ;;

  monitor)
    start_agent "Remember the codeword $CODE. Use the Monitor tool (not Bash) on this command: node -e \"setTimeout(()=>console.log('MONITOR_LINE'),${DELAY:-60}000)\" . Then reply 'watching' and end your turn at once. Do not poll."
    wait_state '^done$' 90; snapshot "turn ended (monitor prints in ~60s)"
    watch "${WATCH:-180}" 30 ;;

  subagent)
    start_agent "Remember the codeword $CODE. Use the Agent tool with run_in_background true, model haiku, to start a sub-agent whose task is: start a Bash command node -e \"setTimeout(()=>{},${DELAY:-60}000)\" with run_in_background, wait until it finishes, then reply 'sub-done'. Then reply 'started' and end your turn at once. Do not poll."
    wait_state '^done$' 90; snapshot "turn ended (sub-agent runs ~60-90s)"
    watch "${WATCH:-180}" 30 ;;

  kill-*)
    IFS=- read -r _ SIG TARGET WHEN <<<"$CASE"
    if [ "$WHEN" = idle ]; then
      start_agent "Reply with exactly: $CODE"
      wait_state '^done$' 60
    else
      start_agent "Run this ONE Bash command in the foreground (not in the background) with timeout 110000: node -e \"setTimeout(()=>{},100000)\" . Then reply 'finished'."
      wait_state '^working$' 30; sleep 25
    fi
    snapshot "before kill"
    PIDS=$(roster_pid pid); REPL=$(roster_pid replPid)
    SUP=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.env.HOME+"/.claude/daemon.status.json","utf8")).supervisorPid)')
    TPID=$PIDS; [ "$TARGET" = replPid ] && TPID=$REPL
    [ "$TPID" = "$SUP" ] && { echo "refusing to signal the supervisor"; exit 1; }
    say "process tree before kill:"; ps -o pid,ppid,stat,cmd --forest -p "$PIDS,$REPL,$(pgrep -P "$REPL" | paste -sd,)" 2>/dev/null | cut -c1-110 | sed 's/^/  /'
    say "kill -$SIG $TPID ($TARGET)"; kill -"$SIG" "$TPID"
    watch "${WATCH:-60}" 15 ;;

  stop)
    start_agent "Run this ONE Bash command in the foreground (not in the background) with timeout 110000: node -e \"setTimeout(()=>{},100000)\" . Then reply 'finished'."
    wait_state '^working$' 30; sleep 25; snapshot "before claude stop"
    say "claude stop $ID"; cclaude stop "$ID" 2>&1 | sed 's/^/  stop> /'
    watch "${WATCH:-30}" 15 ;;

  badmodel)
    MODEL=claude-nonexistent-model-1
    start_agent "Reply with exactly: $CODE"
    sleep 20; snapshot "+20s"; watch "${WATCH:-60}" 20
    say "claude logs (last lines, ANSI stripped):"; cclaude logs "$ID" 2>&1 | sed 's/\x1b\[[0-9;?]*[A-Za-z]//g' | grep -v '^\s*$' | tail -8 | cut -c1-200 | sed 's/^/  /' ;;

  exit-resume)
    start_agent "Reply with exactly: $CODE"
    wait_state '^done$' 60; snapshot "turn ended"
    OUT=$( cd "$SCR" && cclaude --bg --resume "$SID" "/exit" 2>&1 ); echo "$OUT" | sed 's/^/  resume> /'
    COPY=$(echo "$OUT" | grep -m1 '^backgrounded' | grep -oE '[0-9a-f]{8}' | head -1)
    EXTRA_IDS=$COPY; say "copy id: $COPY"; sleep 25; snapshot "original, 25 s after /exit sent via --bg --resume"
    say "the copy:"; cclaude agents --json --all | node -e 'const a=JSON.parse(require("fs").readFileSync(0,"utf8"));const s=a.find(x=>x.id===process.argv[1]);console.log("  ",JSON.stringify({status:s?.status,state:s?.state}))' "$COPY"
    grep "$COPY" "$DAEMON_LOG" | tail -3 | sed 's/^/  daemon.log> /' ;;

  exit-attach)
    start_agent "Reply with exactly: $CODE"
    wait_state '^done$' 60; snapshot "turn ended"
    T="tmux -L ad8-exit-causes"
    $T new-session -d -s a -x 200 -y 50 -c "$SCR" "env -i HOME=$HOME USER=$USER PATH=$PATH TERM=xterm-256color LANG=C.UTF-8 XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/$(id -u)} claude attach $ID"
    sleep 8; say "attach screen:"; $T capture-pane -t a -p | grep -v '^\s*$' | tail -4 | cut -c1-120 | sed 's/^/  tmux> /'
    $T send-keys -t a "/exit"; sleep 1; $T send-keys -t a Enter; sleep 8
    say "after /exit: tmux session list and screen:"; $T ls 2>&1 | sed 's/^/  tmux> /'; $T capture-pane -t a -p 2>&1 | grep -v '^\s*$' | tail -4 | cut -c1-120 | sed 's/^/  tmux> /'
    snapshot "after /exit typed in claude attach" ;;

  *) echo "unknown case $CASE"; exit 2 ;;
esac
say "cleaning up"
