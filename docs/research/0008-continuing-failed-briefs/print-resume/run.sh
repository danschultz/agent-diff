#!/usr/bin/env bash
# Option print-resume: continue an agent session whose worker was killed with
# print mode, `claude -p --resume <session-id> "<prompt>"`, then check
# `claude -p --continue` and a later `claude --bg --resume` of the same ID.
#
# Usage: ./run.sh
# Environment: AD8_MODE=idle|midturn|stop|midturn-stop, AD8_KILL=repl|host, AD8_NOTES=<file>,
#   AD8_KEEP=1. See ../common/lib.sh.
set -u
export AD8_OPTION=print-resume
source "$(dirname "$0")/../common/lib.sh"

stops() { grep -c '"event":"Stop"' "$AD8_HOOKS" 2>/dev/null; }
print_turn() { # print_turn <label> <args...>
  local label=$1 out
  shift
  say "$label: claude -p $*"
  # stdin from /dev/null: since 2.1.309, print mode warns on stdout or stderr
  # when stdin is an empty pipe, which breaks the JSON.
  out=$(cd "$AD8_SCRATCH" && cc -p --output-format json --model "$AD8_MODEL" "$@" </dev/null 2>&1)
  echo "$out" | node "$AD8_COMMON/printresult.mjs" | sed 's/^/    | /' | tee -a "${AD8_NOTES:-/dev/null}"
}

ad8_setup || { ad8_cleanup; exit 1; }

# 1. Continue with print mode. implement's start flags are given again, because
#    print mode doesn't read the saved ones (state.json respawnFlags).
print_turn "print --resume" --resume "$AD8_SID" --permission-mode auto \
  --settings "$AD8_SCRATCH/settings.json" "$AD8_CONTINUE_PROMPT"
say "after print: claude agents --json (active) lists the scratch directory's agent sessions: $(ad8_mine --active | cut -f1,3,4 | tr '\t' ' ' | paste -sd';' -)"
say "after print: claude agents --json --all: $(ad8_mine | cut -f1,3,4 | tr '\t' ' ' | paste -sd';' -)"
say "after print: transcript files: $(ls "$(ad8_projects_dir)" | sed 's/\(........\).*/\1/' | paste -sd, -)"
ad8_report

# 2. --continue from the scratch directory: the only conversation there is the
#    killed one, so it should pick that.
print_turn "print --continue (only one conversation)" --continue --permission-mode auto \
  --settings "$AD8_SCRATCH/settings.json" "What is the codeword? Answer with just the codeword."

# 3. A decoy conversation in the same directory, then --continue again.
print_turn "decoy conversation" --settings "$AD8_SCRATCH/settings.json" "Reply with the single word DECOY."
print_turn "print --continue (after the decoy)" --continue --permission-mode auto \
  --settings "$AD8_SCRATCH/settings.json" "What is the codeword? If you do not know a codeword, say UNKNOWN."
say "codeword in use: $AD8_CODEWORD"
say "transcript files now: $(ls "$(ad8_projects_dir)" | sed 's/\(........\).*/\1/' | paste -sd, -)"

# 4. Does a later claude --bg --resume of the same ID see the print-mode turns?
n=$(stops)
say "claude --bg --resume $AD8_SID (after the print-mode turns)"
out=$(cd "$AD8_SCRATCH" && cc --bg --resume "$AD8_SID" "Say the codeword. Then say yes or no: did an earlier message in this conversation say 'Your agent session exited before you finished'? Do not use any tools." 2>&1)
echo "$out" | sed 's/^/    | /' | tee -a "${AD8_NOTES:-/dev/null}"
ad8_wait 120 "a new Stop hook" bash -c "[[ \$(grep -c '\"event\":\"Stop\"' '$AD8_HOOKS') -gt $n ]]"
sleep 3
say "after the bg resume: agents --all: $(ad8_mine | cut -f1,3,4 | tr '\t' ' ' | paste -sd';' -); bridgeSessionId present $(node "$AD8_COMMON/jobstate.mjs" "$AD8_SHORT" bridge), $([[ $(node "$AD8_COMMON/jobstate.mjs" "$AD8_SHORT" bridgehash) == "$AD8_BRIDGE0" ]] && echo same || echo different) as before"
node "$AD8_COMMON/inspect.mjs" "$(ad8_transcript "$AD8_SID")" "Say the codeword. Then say yes or no" | grep -E 'last assistant|first assistant' | sed 's/^/    | /' | tee -a "${AD8_NOTES:-/dev/null}"
say "hooks log in full:"
node -e '
  for (const l of require("fs").readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean)) { const e = JSON.parse(l);
    console.log(`    | ${e.time.slice(11, 19)} ${e.event} ${String(e.session_id).slice(0, 8)} ${e.source ?? e.reason ?? ""} ${e.permission_mode ?? ""}`); }
' "$AD8_HOOKS" | tee -a "${AD8_NOTES:-/dev/null}"
ad8_cleanup
