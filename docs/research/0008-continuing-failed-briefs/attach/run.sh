#!/usr/bin/env bash
# Tries `claude attach <id>` on an agent session whose worker was SIGKILLed, driving it
# from a detached tmux server (-L ad8-attach) because attach needs a terminal.
# Prints a short summary. Cleans up unless KEEP=1.
set -u
OPT=attach
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/lib.sh"
TM="tmux -L ad8-attach"

start_until_done || exit 1
cp "$(state_file)" "$SCRATCH/state.before.json"
log "before kill: state=$(agent_state) bridge=$([ -n "$(jt get bridgeSessionId < "$(state_file)")" ] && echo yes || echo no)"
kill_worker || exit 1
sleep 12

$TM kill-server 2>/dev/null
log "claude attach $SHORT in tmux"
$TM new-session -d -x 200 -y 50 -c "$SCRATCH" \
  "env -i HOME='$HOME' USER='$USER' PATH='$PATH' TERM=xterm-256color LANG=C.UTF-8 XDG_RUNTIME_DIR='${XDG_RUNTIME_DIR:-}' claude attach $SHORT; sleep 600"
# Wait until the agent session is back (its SessionStart(resume) hook fired) and the input box is up.
for i in $(seq 1 40); do
  grep -q '"source":"resume"' "$SCRATCH/hooks.jsonl" && break
  sleep 1
done
for i in $(seq 1 20); do
  pane=$($TM capture-pane -p 2>/dev/null)
  echo "$pane" | grep -q 'connecting' || { echo "$pane" | grep -q '^❯' && break; }
  sleep 1
done
sleep 3
log "attached: $(agent_json | sed 's#"cwd":"[^"]*",##')"
$TM send-keys -l "$(CONTINUE_PROMPT | tr '\n' ' ')"; sleep 1; $TM send-keys Enter
# If the prompt was not submitted (no UserPromptSubmit hook within 15 s), press Enter again.
for i in $(seq 1 15); do [ "$(grep -c UserPromptSubmit "$SCRATCH/hooks.jsonl")" -ge 2 ] && break; sleep 1; done
[ "$(grep -c UserPromptSubmit "$SCRATCH/hooks.jsonl")" -ge 2 ] || { log "prompt not submitted, pressing Enter again"; $TM send-keys Enter; }
wait_pr
SENT=$(date +%s)
sleep 5
$TM send-keys Left; sleep 3        # detach to the agent view
$TM kill-server                    # and drop the terminal altogether
sleep 5

T=$(transcript "$SID")
echo "---- summary (attach) ----"
echo "attach brought the agent session back: listed in claude agents --json: $([ "$(cclaude agents --json | jt agent "$SHORT")" != null ] && echo yes || echo no)"
echo "session id same: $([ "$(agent_json | jt get sessionId)" = "$SID" ] && echo yes || echo no); short id same: $([ "$(agent_json | jt get id)" = "$SHORT" ] && echo yes || echo no); name: $(agent_json | jt get name)"
echo "continued and did the work (PR_OPENED): $([ -f "$SCRATCH/PR_OPENED" ] && echo yes || echo no)"
echo "codeword remembered: $(grep -q "CODEWORD_IS=$CODEWORD" "$T" && echo yes || echo no)"
echo "background command said to be running: $(grep -o 'BG_RUNNING=[a-z]*' "$T" | tail -1) (real process still alive: $(for p in $(pgrep -f 'setTimeout\(\(\)=>\{\},900000\)'); do [ "$(readlink /proc/$p/cwd)" = "$SCRATCH" ] && echo yes && break; done))"
echo "bridge: $([ -n "$(jt get bridgeSessionId < "$(state_file)")" ] && echo present || echo absent), $([ "$(jt get bridgeSessionId < "$(state_file)")" = "$(jt get bridgeSessionId < "$SCRATCH/state.before.json")" ] && echo same || echo different) as before; bridge_status entries in transcript: $(grep -c '"subtype":"bridge_status"' "$T") with $(grep -o '"subtype":"bridge_status"[^}]*"url":"[^"]*"' "$T" | grep -o 'url":"[^"]*' | sort -u | wc -l) distinct url(s)"
echo "first request usage after the prompt: $(first_usage_after "$T" 'Continue. Say the codeword')"
echo "hooks by session_id: $(node -e "const c={};for(const l of require('fs').readFileSync('$SCRATCH/hooks.jsonl','utf8').trim().split('\n')){const e=JSON.parse(l);const k=e.session_id.slice(0,8)+':'+e.event+(e.source?'('+e.source+')':'');c[k]=(c[k]||0)+1}console.log(JSON.stringify(c))")"
echo "agent session still listed after the terminal was killed: $([ "$(cclaude agents --json | jt agent "$SHORT")" != null ] && echo yes || echo no)"
echo "agents --json --all:"; agent_json | sed 's#"cwd":"[^"]*",##'

if [ "${KEEP:-0}" != 1 ]; then
  for p in $(pgrep -f 'setTimeout\(\(\)=>\{\},900000\)'); do [ "$(readlink /proc/$p/cwd)" = "$SCRATCH" ] && kill $p 2>/dev/null; done
  cleanup_session; rm -rf "$SCRATCH"
fi
