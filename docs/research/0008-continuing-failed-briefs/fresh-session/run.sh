#!/usr/bin/env bash
# Starts a FRESH agent session in the kept scratch dir of one that was SIGKILLed, with a prompt
# built by build-prompt.mjs (task + dir listing + old last assistant text, no old conversation).
# Uses implement's start flags, the same --name / --remote-control name as the dead one.
# Prints a short summary. Cleans up unless KEEP=1.
set -u
OPT=fresh-session
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/lib.sh"

start_until_done || exit 1
OLD_SHORT=$SHORT; OLD_SID=$SID
cp "$(state_file)" "$SCRATCH/state.before.json"
log "old: short=$OLD_SHORT session=$OLD_SID bridge=$([ -n "$(jt get bridgeSessionId < "$(state_file)")" ] && echo yes || echo no)"
kill_worker || exit 1
sleep 12

PROMPT=$(node "$HERE/build-prompt.mjs" --dir "$SCRATCH" --task "$HERE/task.txt" --session-id "$OLD_SID")
echo "$PROMPT" > "$SCRATCH.prompt.txt"
log "prompt built: $(echo "$PROMPT" | wc -c) bytes, $(echo "$PROMPT" | wc -w) words"
PROGRESS_BEFORE=$(stat -c %Y "$SCRATCH/progress.txt")
BG_BEFORE=$(pgrep -f 'setTimeout\(\(\)=>\{\},900000\)' | while read p; do [ "$(readlink /proc/$p/cwd)" = "$SCRATCH" ] && echo $p; done | wc -l)

# implement's start flags, the old name, plus --model haiku.
out=$(cd "$SCRATCH" && cclaude --bg --remote-control "$NAME" --name "$NAME" --permission-mode auto \
  --settings "$SCRATCH/settings.json" --model "$MODEL" "$PROMPT" 2>&1)
echo "$out" | head -3
NEW_SHORT=$(echo "$out" | sed -n 's/^backgrounded · \([0-9a-f]\{8\}\).*/\1/p')
wait_pr
sleep 8
NEW_SID=$(cclaude agents --json --all | jt agent "$NEW_SHORT" | jt get sessionId)
T=$(transcript "$NEW_SID")

echo "---- summary (fresh-session) ----"
echo "continued and did the work (PR_OPENED): $([ -f "$SCRATCH/PR_OPENED" ] && echo yes || echo no)"
echo "session id: $([ "$NEW_SID" = "$OLD_SID" ] && echo same || echo different); short id: $([ "$NEW_SHORT" = "$OLD_SHORT" ] && echo same || echo "different ($OLD_SHORT -> $NEW_SHORT)")"
echo "name given to the new agent session: $NAME; listed as: $(cclaude agents --json --all | jt agent "$NEW_SHORT" | jt get name)"
echo "codeword remembered: $(grep -q "CODEWORD_IS=$CODEWORD" "$T" && echo yes || echo no) ($(grep -o 'CODEWORD_IS=[A-Za-z0-9-]*' "$T" | grep -v '<word>' | tail -1))"
echo "progress.txt rewritten (step 2 redone): $([ "$(stat -c %Y "$SCRATCH/progress.txt")" != "$PROGRESS_BEFORE" ] && echo yes || echo no)"
echo "new background command started (step 1 redone): old orphaned processes $BG_BEFORE, now $(pgrep -f 'setTimeout\(\(\)=>\{\},900000\)' | while read p; do [ "$(readlink /proc/$p/cwd)" = "$SCRATCH" ] && echo $p; done | wc -l) in the scratch dir"
echo "BG_RUNNING answer: $(grep -o 'BG_RUNNING=[a-z]*' "$T" | grep -v '=yes or' | tail -1)"
echo "bridge: $([ -n "$(jt get bridgeSessionId < "$HOME/.claude/jobs/$NEW_SHORT/state.json")" ] && echo present || echo absent), $([ "$(jt get bridgeSessionId < "$HOME/.claude/jobs/$NEW_SHORT/state.json")" = "$(jt get bridgeSessionId < "$SCRATCH/state.before.json")" ] && echo same || echo different) as the old one"
echo "first request usage (fresh): $(node "$HERE/jsontool.mjs" usage "$T" 'taking over a task')"
echo "first request usage (old session, first prompt): $(node "$HERE/jsontool.mjs" usage "$(transcript "$OLD_SID")" 'Remember the codeword')"
echo "hooks by session_id: $(node -e "const c={};for(const l of require('fs').readFileSync('$SCRATCH/hooks.jsonl','utf8').trim().split('\n')){const e=JSON.parse(l);const k=e.session_id.slice(0,8)+':'+e.event+(e.source?'('+e.source+')':'');c[k]=(c[k]||0)+1}console.log(JSON.stringify(c))")"
echo "agents --json --all for old and new:"; cclaude agents --json --all | node -e "for(const s of JSON.parse(require('fs').readFileSync(0))) if(s.id==='$OLD_SHORT'||s.id==='$NEW_SHORT') console.log(' ',JSON.stringify(s).replace(/\"cwd\":\"[^\"]*\",/,''))"

if [ "${KEEP:-0}" != 1 ]; then
  for p in $(pgrep -f 'setTimeout\(\(\)=>\{\},900000\)'); do [ "$(readlink /proc/$p/cwd)" = "$SCRATCH" ] && kill $p 2>/dev/null; done
  for id in "$OLD_SHORT" "$NEW_SHORT"; do cclaude stop "$id" >/dev/null 2>&1; sleep 1; cclaude rm "$id" >/dev/null 2>&1; done
  rm -rf "$SCRATCH.prompt.txt" "$SCRATCH"
fi
