#!/usr/bin/env bash
# Tries `claude respawn <id>` on an agent session whose worker was SIGKILLed.
#   ./run.sh              kill while idle (turn finished)
#   MODE=midturn ./run.sh kill in the middle of a turn
# Prints a short summary. Cleans up its agent sessions unless KEEP=1.
set -u
OPT=respawn
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="${MODE:-idle}"
[ "$MODE" = midturn ] && N="${N:-2}"
source "$HERE/lib.sh"

if [ "$MODE" = midturn ]; then
FIRST_PROMPT() {
  cat <<EOP
Remember the codeword $CODEWORD. Do these in order: (1) start a background Bash command (run_in_background true) that runs for 15 minutes: node -e "setTimeout(()=>{},900000)". (2) write a file progress.txt in the current directory containing exactly: step 1 done. (3) Then run these 12 commands one at a time (foreground, never in parallel): node -e "setTimeout(()=>{},7000)". (4) Create an empty file PR_OPENED. (5) End your turn with the single word ready.
EOP
}
fi

make_scratch
start_session || exit 1
if [ "$MODE" = midturn ]; then
  for i in $(seq 1 60); do [ -f "$SCRATCH/progress.txt" ] && break; sleep 2; done
  sleep 6; log "state before kill: $(agent_state)"
else
  wait_idle || exit 1
fi
cp "$(state_file)" "$SCRATCH/state.before.json"
BRIDGE_BEFORE=$(jt get bridgeSessionId < "$(state_file)" | wc -c)
log "before kill: state=$(agent_state) bridge=$([ "$BRIDGE_BEFORE" -gt 1 ] && echo yes || echo no) respawnFlags=$(jt get respawnFlags < "$(state_file)" | sed 's#/[^"]*/##g')"
if [ "$MODE" = midturn ]; then
  # The daemon restarts a worker killed mid-turn by itself; no `claude respawn` needed.
  read -r pid rpid < <(jt worker "$SHORT" < "$DAEMON_DIR/daemon/roster.json")
  kill -9 $pid $rpid; log "SIGKILL pid=$pid replPid=$rpid mid-turn"
  for i in $(seq 1 120); do [ -f "$SCRATCH/PR_OPENED" ] && break; sleep 3; done; sleep 8
  T=$(transcript "$SID")
  echo "---- summary (midturn) ----"
  echo "daemon restarted worker by itself: $(grep -c '"source":"resume"' "$SCRATCH/hooks.jsonl") SessionStart(resume) hooks, roster attempt=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$DAEMON_DIR/daemon/roster.json')).workers['$SHORT']?.attempt)")"
  echo "turn finished (PR_OPENED created): $([ -f "$SCRATCH/PR_OPENED" ] && echo yes || echo no); Stop hooks: $(grep -c "\"event\":\"Stop\"" "$SCRATCH/hooks.jsonl")"
  echo "usage of first assistant message after restart: $(node "$HERE/jsontool.mjs" usage "$T" 'Continue from where you left off')"
  echo "hooks: $(node -e "const c={};for(const l of require('fs').readFileSync('$SCRATCH/hooks.jsonl','utf8').trim().split('\n')){const e=JSON.parse(l);const k=e.event+(e.source?'('+e.source+')':'');c[k]=(c[k]||0)+1}console.log(JSON.stringify(c))")"
  for p in $(pgrep -f "setTimeout\(\(\)=>\{\},900000\)"); do [ "$(readlink /proc/$p/cwd)" = "$SCRATCH" ] && kill $p; done
  [ "${KEEP:-0}" = 1 ] || { cclaude stop "$SHORT" >/dev/null 2>&1; sleep 1; cclaude rm "$SHORT" >/dev/null 2>&1; rm -rf "$SCRATCH"; }
  exit 0
fi
kill_worker || exit 1
sleep 12; grep -n "$SHORT" "$DAEMON_DIR/daemon.log" | tail -3

log "claude respawn $SHORT"
cclaude respawn "$SHORT"; echo "respawn exit=$?"
sleep 15
log "after respawn: $(agent_json | sed 's#"cwd":"[^"]*",##')"
T=$(transcript "$SID")
echo "hooks after respawn:"; tail -4 "$SCRATCH/hooks.jsonl" | cut -c1-140
echo "transcript entry types: $(jt types "$T")"
BRIDGE_AFTER=$(jt get bridgeSessionId < "$(state_file)")
[ "$(jt get bridgeSessionId < "$SCRATCH/state.before.json")" = "$BRIDGE_AFTER" ] && SAMEB=same || SAMEB=different
log "bridge after respawn: $([ -n "$BRIDGE_AFTER" ] && echo present || echo absent) ($SAMEB as before)"

log "claude --bg --resume $SID (continue prompt)"
out=$(cd "$SCRATCH" && cclaude --bg --resume "$SID" "$(CONTINUE_PROMPT)" 2>&1 | head -1); echo "$out"
wait_pr; sleep 5
COPY=$(echo "$out" | sed -n 's/.*started a copy as \([0-9a-f]\{8\}\).*/\1/p')
echo "---- summary ($MODE) ----"
echo "respawn worked on dead worker: $([ -n "$(agent_json | jt get id)" ] && echo yes || echo no)"
echo "respawn started a turn: $(grep -c UserPromptSubmit "$SCRATCH/hooks.jsonl") UserPromptSubmit hooks in total (1 = only the first prompt)"
echo "resume made a copy: ${COPY:-no}"
echo "PR_OPENED created: $([ -f "$SCRATCH/PR_OPENED" ] && echo yes || echo no)"
if [ -n "$COPY" ]; then
  CSID=$(cclaude agents --json --all | jt agent "$COPY" | jt get sessionId)
  CT=$(transcript "$CSID")
  echo "copy session id differs: $([ "$CSID" != "$SID" ] && echo yes || echo no)"
  echo "copy first request usage: $(first_usage_after "$CT" 'Continue. Say the codeword')"
  echo "codeword remembered: $(grep -q "CODEWORD_IS=$CODEWORD" "$CT" && echo yes || echo no)"
  echo "copy name: $(cclaude agents --json --all | jt agent "$COPY" | jt get name)"
  echo "copy state.json respawnFlags: $(jt get respawnFlags < "$HOME/.claude/jobs/$COPY/state.json")  bridge: $([ -n "$(jt get bridgeSessionId < "$HOME/.claude/jobs/$COPY/state.json")" ] && echo present || echo absent)"
fi
echo "hooks by session_id: $(node -e "const c={};for(const l of require('fs').readFileSync('$SCRATCH/hooks.jsonl','utf8').trim().split('\n')){const e=JSON.parse(l);const k=e.session_id.slice(0,8)+':'+e.event+(e.source?'('+e.source+')':'');c[k]=(c[k]||0)+1}console.log(JSON.stringify(c))")"
echo "orphaned background command still running: $(pgrep -f "setTimeout\(\(\)=>\{\},900000\)" | while read p; do [ "$(readlink /proc/$p/cwd)" = "$SCRATCH" ] && echo yes && break; done)"
echo "agents --json --all for ours:"; cclaude agents --json --all | node -e "for(const s of JSON.parse(require('fs').readFileSync(0))) if(s.id==='$SHORT'||s.id==='${COPY:-x}') console.log(' ',JSON.stringify(s).replace(/\"cwd\":\"[^\"]*\",/,''))"

if [ "${KEEP:-0}" != 1 ]; then
  for p in $(pgrep -f "setTimeout\(\(\)=>\{\},900000\)"); do [ "$(readlink /proc/$p/cwd)" = "$SCRATCH" ] && kill $p 2>/dev/null; done
  for id in "$SHORT" ${COPY:-}; do cclaude stop "$id" >/dev/null 2>&1; sleep 1; cclaude rm "$id" >/dev/null 2>&1; done
  rm -rf "$SCRATCH"
fi
