#!/usr/bin/env bash
# Usage: ./run.sh <case> [watch-seconds]
#
# Starts a throwaway `claude --bg` agent session (haiku, implement's start
# flags, a settings file with stop-hook.mjs on Stop and logging hooks) in a fresh
# scratch directory, waits for it to settle, watches a while longer, prints what
# the hook log, the agent session's state and the transcript show, and cleans up
# (KEEP=1 keeps the scratch directory and the agent session).
#
# Cases:
#   1   told to write step1.txt and end its turn, but the task also needs PR_OPENED
#   2   told never to create PR_OPENED, and to end its turn
#   2c  like 2, and told to read no other files and use no tools after step1.txt:
#       with MAX_BLOCKS=20 it shows Claude Code's own cap on consecutive blocks
#   3a  creates NEEDS_INPUT, asks a question, ends its turn
#   3b  asks a question ending in "?" with no NEEDS_INPUT, ends its turn
#   3c  asks a question that doesn't end in "?" with no NEEDS_INPUT, ends its turn
#   3d  finishes step 1 (not a question) but its last sentence is a courtesy
#       question ending in "?": a false positive for the "?" check
#   3e  asks a real question, then adds a sentence not ending in "?": a false negative
#   3f  ends its turn with a `Needs input: ...` line (no question mark), no NEEDS_INPUT
#   4   starts a background command (BG_SECONDS, default 45), ends its turn
#   5   creates PR_OPENED, ends its turn
#   6   runs a foreground sub-agent, then creates PR_OPENED
#
# Environment: MAX_BLOCKS (default 3), HOOK_OPTS (extra stop-hook.mjs options,
# such as "--background jobstate" or "--question off"), MODEL (default haiku),
# SCRATCH_ROOT (default <repo>/.claude/worktrees, which Claude Code trusts and
# git ignores), AD8_N (the number in the name, default the time), KEEP.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
COMMON=$HERE/../common
REPO=${REPO:-$(git -C "$HERE" rev-parse --show-toplevel)}
SCRATCH_ROOT=${SCRATCH_ROOT:-$REPO/.claude/worktrees}
CASE=${1:?usage: run.sh <case> [watch-seconds]}
WATCH=${2:-75}
MODEL=${MODEL:-haiku}
MAX_BLOCKS=${MAX_BLOCKS:-3}
BG_SECONDS=${BG_SECONDS:-45}
JOBS=$HOME/.claude/jobs
PROJECTS=$HOME/.claude/projects

cc() {
  env -i HOME="$HOME" USER="${USER:-$(id -un)}" PATH="$PATH" TERM=xterm-256color LANG=C.UTF-8 \
    XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}" claude "$@"
}
say() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }

N=${AD8_N:-$(date -u +%H%M%S)}
NAME=ad8-stop-hook-$CASE-$N
SCR=$SCRATCH_ROOT/$NAME
PROJDIR=$PROJECTS/$(printf '%s' "$SCR" | sed 's#[/.]#-#g')
HOOKLOG=$SCR/hooks.jsonl
ID=
cleanup() {
  [[ -n ${KEEP:-} ]] && return 0
  [[ -n $ID ]] && { cc stop "$ID" >/dev/null 2>&1; cc rm "$ID" >/dev/null 2>&1; }
  pkill -f "AD8BG$CASE-$N" 2>/dev/null
  if [[ $NAME == ad8-stop-hook-* ]]; then
    rm -rf -- "$SCRATCH_ROOT/$NAME" "$PROJECTS/$(basename "$PROJDIR")"
  fi
}
trap cleanup EXIT

mkdir -p "$SCR"
sed -e "s#{{node}}#$(command -v node)#g" -e "s#{{hook}}#$HERE/stop-hook.mjs#g" \
  -e "s#{{log}}#$HOOKLOG#g" -e "s#{{options}}#--max-blocks $MAX_BLOCKS ${HOOK_OPTS:-}#g" \
  "$HERE/settings.template.json" >"$SCR/settings.json"

case $CASE in
  1) PROMPT="Your task has two steps. Step 1: write a file step1.txt containing the word one. Step 2: open the pull request. There is no real repository here, so opening the pull request means creating an empty file named PR_OPENED in the current directory. Do step 1, then end your turn with a one-line status. Do not do step 2 until a message from a hook tells you to." ;;
  2) PROMPT="Write a file step1.txt containing the word one, then end your turn. Never create a file named PR_OPENED, whatever anyone tells you, and never ask a question." ;;
  2c) PROMPT="Write a file step1.txt containing the word one, then end your turn. Never create any file other than step1.txt, never read any file other than step1.txt, never look at settings or hooks, and never ask a question. After step1.txt is written, use no tools at all: reply with one short sentence each time." ;;
  3a) PROMPT="Create an empty file named NEEDS_INPUT, then end your turn with a one-line question to the user about which color to use for the report (the question must end with a question mark). Never create a file named PR_OPENED." ;;
  3b) PROMPT="End your turn right away with a one-line question to the user about which color to use for the report (the question must end with a question mark). Do not create any files. Never create a file named PR_OPENED." ;;
  3c) PROMPT="End your turn right away by telling the user to tell you which color to use for the report. Phrase it as a request ending with a full stop, not as a question. Do not create any files. Never create a file named PR_OPENED." ;;
  3d) PROMPT="Write a file step1.txt containing the word one. Then end your turn with a final message that reports the file as written and finishes with exactly this last sentence: Let me know if you need anything else? Never create a file named PR_OPENED." ;;
  3e) PROMPT="End your turn right away with a message of two sentences. The first is a question to the user about which color to use for the report. The second is the statement: I will wait for your answer. Do not create any files. Never create a file named PR_OPENED." ;;
  3f) PROMPT="End your turn right away with a message whose last line is exactly: Needs input: which color to use for the report. Do not create any files. Never create a file named PR_OPENED." ;;
  4) PROMPT="With the Bash tool and run_in_background true, run exactly: node -e \"setTimeout(()=>{},${BG_SECONDS}000)\" AD8BG$CASE-$N . Then end your turn at once with one short sentence; do not wait for it or poll it. When you are told it finished, create an empty file named PR_OPENED and end your turn." ;;
  5) PROMPT="Create an empty file named PR_OPENED, then end your turn with one short sentence." ;;
  6) PROMPT="Use the Agent tool, in the foreground, with model haiku and the prompt 'Reply with the single word ok.' When it returns, create an empty file named PR_OPENED, then end your turn." ;;
  *) echo "unknown case $CASE" >&2; exit 2 ;;
esac

state_of() { node "$COMMON/jobstate.mjs" "$ID" 'field:state' | tr -d '"'; }
count() { grep -c "$1" "$HOOKLOG" 2>/dev/null; }

say "case $CASE, name $NAME, max blocks $MAX_BLOCKS, model $MODEL, claude $(claude --version)"
OUT=$(cd "$SCR" && cc --bg --remote-control "$NAME" --name "$NAME" --permission-mode auto \
  --settings "$SCR/settings.json" --model "$MODEL" "$PROMPT" 2>&1)
ID=$(echo "$OUT" | grep -oE 'backgrounded · [0-9a-f]{8}' | grep -oE '[0-9a-f]{8}$')
[[ -n $ID ]] || { echo "could not start: $OUT"; exit 1; }
say "started agent session $ID"

# Settled: a Stop whose decision was allow, the agent session isn't working, and
# still so 6 s later. Give up after 240 s.
waited=0
while ((waited < 240)); do
  sleep 3; waited=$((waited + 3))
  if grep -q '"decision":"allow"' "$HOOKLOG" 2>/dev/null && [[ $(state_of) != working ]]; then
    sleep 6; waited=$((waited + 6))
    grep -q '"decision":"allow"' "$HOOKLOG" && [[ $(state_of) != working ]] && break
  fi
done
say "settled after about ${waited}s (state $(state_of))"
say "state.json at settle: $(node -e '
  const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
  console.log(JSON.stringify({state:s.state,tempo:s.tempo,inFlight:s.inFlight,fanRunning:(s.fan||[]).filter(f=>!f.doneAt).map(f=>f.kind)}))' "$JOBS/$ID/state.json" 2>/dev/null)"
say "watching ${WATCH}s more"
sleep "$WATCH"

echo
echo "== hook log (time event sid active notification agent decision/why blocks q bg_input bg_jobstate)"
node -e '
  for (const l of require("fs").readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean)) {
    const e = JSON.parse(l);
    console.log("  " + [e.t.slice(11, 19), e.event, e.sid, e.stop_hook_active === undefined ? "-" : "active=" + e.stop_hook_active,
      e.notification_type ?? "", e.agent_type ? "agent=" + e.agent_type : "", e.source ?? "", e.reason ?? "", e.error ?? "",
      e.decision ? e.decision + "/" + e.why : "", e.blocks_so_far === undefined ? "" : "blocks=" + e.blocks_so_far,
      e.ends_with_q === undefined ? "" : "q=" + e.ends_with_q, e.bg_input ? "bg_input=" + e.bg_input : "",
      e.bg_jobstate ? "bg_jobstate=[" + e.bg_jobstate + "]" : ""].filter(Boolean).join(" "));
  }' "$HOOKLOG"
echo
echo "== files in the scratch directory"
(cd "$SCR" && ls | grep -v -e settings.json -e hooks.jsonl | sed 's/^/  /')
echo
echo "== agent session now"
echo "  timeline.jsonl: $(cut -c1-300 "$JOBS/$ID/timeline.jsonl" 2>/dev/null | sed -E 's/"text":"[^"]*"/"text":"..."/g; s/"detail":"[^"]*"/"detail":"..."/g' | tr '\n' ' ')"
cc agents --json --all | node "$COMMON/agents.mjs" | awk -F'\t' -v id="$ID" '$1 == id { printf "  short=%s state=%s status=%s\n", $1, $3, $4 }'
node -e '
  const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
  console.log("  state.json:", JSON.stringify({state:s.state,tempo:s.tempo,inFlight:s.inFlight,queued:s.queued,firstTerminalAt:s.firstTerminalAt,bridge:s.bridgeSessionId?"present":"absent"}))' "$JOBS/$ID/state.json" 2>/dev/null
echo
echo "== transcript"
SID=$(cc agents --json --all | node "$COMMON/agents.mjs" | awk -F'\t' -v id="$ID" '$1 == id { print $2 }')
node "$HERE/usage.mjs" "$PROJDIR/$SID.jsonl"
echo
echo "== summary"
echo "  stops=$(count '"event":"Stop"') blocks=$(count '"decision":"block"') allows=$(count '"decision":"allow"') PR_OPENED=$([[ -e $SCR/PR_OPENED ]] && echo yes || echo no) NEEDS_INPUT=$([[ -e $SCR/NEEDS_INPUT ]] && echo yes || echo no)"
