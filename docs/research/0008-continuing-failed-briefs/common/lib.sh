#!/usr/bin/env bash
# Shared steps for the 0008 prototypes. A run.sh sets AD8_OPTION, sources this
# file, calls ad8_setup (start a throwaway agent session, wait until it is idle,
# kill its worker), continues the agent session its own way, and calls
# ad8_report. See the README in each option's directory.
#
# Settings, all overridable with environment variables:
#   AD8_N        number in the agent session's name, ad8-<option>-<n>. Default 1.
#   AD8_MODE     how the first agent session ends before it is continued:
#                  idle     (default) it finished its turn, then its worker is killed
#                  midturn  its worker is killed while a foreground command runs.
#                           The daemon then restarts the worker by itself.
#                  stop     it finished its turn, then `claude stop` stops it
#                  midturn-stop  `claude stop` stops it while a foreground command
#                           runs, so the daemon doesn't restart it
#   AD8_KILL     which process of the worker gets SIGKILL: repl (default, the
#                claude process) or host (the pty host that runs it)
#   AD8_NOTES    a file to append everything printed to, with the time
#   AD8_SCRATCH  the scratch directory. Default <repo>/.claude/worktrees/<name>.
#                It must be a plain directory under the repo's ignored
#                .claude/worktrees, not a git repo, so Claude Code trusts it.
#   AD8_GAP      seconds to wait between the kill and continuing. Over 300 lets
#                the prompt cache expire, so the first request pays for the whole
#                conversation. Default 0.
#   AD8_KEEP     1 to leave the agent sessions and scratch directory in place
#   AD8_MODEL    model for the first agent session. Default haiku.

AD8_COMMON=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
AD8_ROOT=$(git -C "$AD8_COMMON" rev-parse --show-toplevel)
: "${AD8_OPTION:?set AD8_OPTION before sourcing lib.sh}"
AD8_N=${AD8_N:-1}
AD8_MODE=${AD8_MODE:-idle}
AD8_KILL=${AD8_KILL:-repl}
AD8_MODEL=${AD8_MODEL:-haiku}
AD8_NAME=ad8-$AD8_OPTION-$AD8_N
AD8_SCRATCH=${AD8_SCRATCH:-$AD8_ROOT/.claude/worktrees/$AD8_NAME}
AD8_NOTES=${AD8_NOTES:-}
AD8_KEEP=${AD8_KEEP:-0}
AD8_CODEWORD=PLUM-$RANDOM$RANDOM
AD8_BGMARK=AD8BG$RANDOM$RANDOM
AD8_FGMARK=AD8FG$RANDOM$RANDOM
AD8_CONTINUE_PROMPT='Your agent session exited before you finished. Say the codeword, say whether your background command is still running, then create an empty file named PR_OPENED in the current directory (a test marker, not a real pull request) and end your turn.'
AD8_HOOKS=$AD8_SCRATCH/hooks.jsonl
AD8_DAEMON_LOG=$HOME/.claude/daemon.log

say() {
  local line
  line="$(date -u +%H:%M:%S) $*"
  echo "$line"
  [[ -n $AD8_NOTES ]] && echo "$line" >>"$AD8_NOTES"
  return 0
}

# Run claude in the clean environment implement uses.
cc() {
  env -i HOME="$HOME" USER="${USER:-$(id -un)}" PATH="$PATH" TERM=xterm-256color \
    LANG=C.UTF-8 XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}" claude "$@"
}

# The projects directory for the scratch directory's transcripts.
ad8_projects_dir() {
  local dir
  dir=$(printf '%s' "$AD8_SCRATCH" | sed 's#[/.]#-#g')
  echo "$HOME/.claude/projects/$dir"
}

# Agent sessions whose cwd is the scratch directory: short id, session id,
# state, status, name. Pass --active for only those with a live process.
ad8_mine() {
  if [[ ${1:-} == --active ]]; then
    cc agents --json
  else
    cc agents --json --all
  fi | node "$AD8_COMMON/agents.mjs" | awk -F'\t' -v cwd="$AD8_SCRATCH" '$6 == cwd'
}

ad8_state_of() { ad8_mine | awk -F'\t' -v id="$1" '$1 == id { print $3 }'; }

# ad8_wait <seconds> <description> <command...>: wait until the command succeeds.
ad8_wait() {
  local limit=$1 what=$2 waited=0
  shift 2
  until "$@"; do
    if ((waited >= limit)); then
      say "TIMEOUT after ${limit}s waiting for $what"
      return 1
    fi
    sleep 2
    waited=$((waited + 2))
  done
}

# True when the agent session is not working: its state is not "working", or its
# process says it is idle. (After some continuations the state stays "working"
# while the process is idle.)
ad8_not_working() {
  ad8_mine | awk -F'\t' -v id="$1" '$1 == id { found = 1; if ($3 != "working" || $4 == "idle") ok = 1 } END { exit !(found && ok) }'
}

# True when the file exists and the agent session is not working. Checked twice
# a few seconds apart, because the state can flicker between tool calls.
ad8_idle_with_file() {
  local short=$1 file=$2
  [[ -e $file ]] || return 1
  ad8_not_working "$short" || return 1
  sleep 3
  ad8_not_working "$short"
}

ad8_prepare() {
  mkdir -p "$AD8_SCRATCH"
  rm -f "$AD8_HOOKS"
  sed -e "s#{{node}}#$(command -v node)#g" -e "s#{{hook}}#$AD8_COMMON/hook.mjs#g" \
    -e "s#{{log}}#$AD8_HOOKS#g" "$AD8_COMMON/settings.template.json" >"$AD8_SCRATCH/settings.json"
}

ad8_first_prompt() {
  local p="Remember the codeword $AD8_CODEWORD. Do these in order. (1) With the Bash tool and run_in_background true, run exactly: node -e \"setTimeout(()=>{},900000)\" $AD8_BGMARK (2) Write the file progress.txt in the current directory containing: step 1 done"
  if [[ $AD8_MODE == midturn* ]]; then
    p="$p (3) With the Bash tool in the foreground, run exactly: node -e \"setTimeout(()=>{},600000)\" $AD8_FGMARK (4) Then end your turn."
  else
    p="$p (3) End your turn with one short sentence. Do not wait for the background command."
  fi
  printf '%s' "$p"
}

ad8_start_first() {
  local out
  out=$(cd "$AD8_SCRATCH" && cc --bg --remote-control "$AD8_NAME" --name "$AD8_NAME" \
    --permission-mode auto --settings "$AD8_SCRATCH/settings.json" --model "$AD8_MODEL" \
    "$(ad8_first_prompt)" 2>&1)
  echo "$out" | sed 's/^/    | /'
  AD8_SHORT=$(echo "$out" | grep -oE 'backgrounded · [0-9a-f]{8}' | grep -oE '[0-9a-f]{8}$')
  [[ -n $AD8_SHORT ]] || {
    say "could not start the agent session"
    return 1
  }
}

# Starts the first agent session, waits for it, kills its worker (or stops it),
# and records what is known before continuing. Sets AD8_SHORT, AD8_SID,
# AD8_BRIDGE0 (a hash, never printed), AD8_LOG0.
ad8_setup() {
  say "== $AD8_OPTION: setup (name $AD8_NAME, mode $AD8_MODE, kill $AD8_KILL, model $AD8_MODEL)"
  say "claude $(claude --version)"
  ad8_prepare
  ad8_start_first || return 1
  say "started: short id $AD8_SHORT"
  if [[ $AD8_MODE == midturn* ]]; then
    ad8_wait 120 "progress.txt and the foreground command" ad8_fg_running || return 1
  else
    ad8_wait 180 "an idle agent session with progress.txt" \
      ad8_idle_with_file "$AD8_SHORT" "$AD8_SCRATCH/progress.txt" || return 1
  fi
  AD8_SID=$(ad8_mine | awk -F'\t' -v id="$AD8_SHORT" '$1 == id { print $2 }')
  AD8_BRIDGE0=$(node "$AD8_COMMON/jobstate.mjs" "$AD8_SHORT" bridgehash)
  say "before: session id $AD8_SID, state $(ad8_state_of "$AD8_SHORT"), bridgeSessionId present $(node "$AD8_COMMON/jobstate.mjs" "$AD8_SHORT" bridge)"
  say "before: respawnFlags $(node "$AD8_COMMON/jobstate.mjs" "$AD8_SHORT" flags)"
  say "before: background command running: $(ad8_bg_running)"
  say "before: hooks log: $(grep -o '"event":"[A-Za-z]*"' "$AD8_HOOKS" | cut -d'"' -f4 | paste -sd, -)"
  say "before: transcript $(wc -l <"$(ad8_transcript "$AD8_SID")") lines"

  AD8_LOG0=$(wc -l <"$AD8_DAEMON_LOG")
  if [[ $AD8_MODE == stop || $AD8_MODE == midturn-stop ]]; then
    say "claude stop $AD8_SHORT"
    cc stop "$AD8_SHORT" 2>&1 | sed 's/^/    | /'
  else
    local pids pid repl
    pids=$(node "$AD8_COMMON/roster.mjs" "$AD8_SHORT")
    pid=${pids% *}
    repl=${pids#* }
    say "roster: pid $pid (pty host), replPid $repl (claude process)"
    local target=$repl
    [[ $AD8_KILL == host ]] && target=$pid
    say "kill -9 $target ($AD8_KILL)"
    kill -9 "$target"
  fi
  AD8_KILLED_AT=$(date -u +%FT%T)
  if ad8_wait 60 "the agent session to leave claude agents --json" ad8_gone_from_active "$AD8_SHORT"; then
    say "gone from claude agents --json (the active list)"
  fi
  sleep 8
  say "daemon.log lines since the kill:"
  tail -n +"$((AD8_LOG0 + 1))" "$AD8_DAEMON_LOG" | sed 's/^/    | /' | tee -a "${AD8_NOTES:-/dev/null}"
  say "after kill, claude agents --json --all: $(ad8_mine | awk -F'\t' -v id="$AD8_SHORT" '$1 == id { printf "state=%s status=%s", $3, $4 }')"
  say "after kill: background command running: $(ad8_bg_running)"
  if ((${AD8_GAP:-0} > 0)); then
    say "waiting ${AD8_GAP}s before continuing, so the prompt cache expires"
    sleep "$AD8_GAP"
  fi
}

ad8_fg_running() {
  [[ -e $AD8_SCRATCH/progress.txt ]] && pgrep -f "$AD8_FGMARK" >/dev/null
}

ad8_gone_from_active() {
  ! cc agents --json | node "$AD8_COMMON/agents.mjs" | awk -F'\t' -v id="$1" '$1 == id { found = 1 } END { exit !found }'
}

ad8_bg_running() {
  local n
  n=$(pgrep -f "$AD8_BGMARK" | wc -l)
  if ((n > 0)); then echo "yes ($n processes)"; else echo no; fi
}

# The transcript file for a session id, found under the scratch directory's
# projects directory (the file is created when the agent session starts).
ad8_transcript() { echo "$(ad8_projects_dir)/$1.jsonl"; }

# Waits for the continued agent session to create PR_OPENED and stop working.
# $1: a command that prints the short id to watch (default: the original).
ad8_wait_continued() {
  local short=${1:-$AD8_SHORT}
  ad8_wait 240 "PR_OPENED and a non-working state" ad8_idle_with_file "$short" "$AD8_SCRATCH/PR_OPENED"
}

# Prints what the continued agent session looks like. $1: the short id the
# continuation used (default the original). $2: the session id (default: the
# original; if it is new, the new one is found from claude agents).
ad8_report() {
  local short=${1:-$AD8_SHORT}
  say "== $AD8_OPTION: results"
  local sessions
  sessions=$(ad8_mine)
  say "claude agents --json --all, agent sessions started in the scratch directory (short, session, state, status, name):"
  echo "$sessions" | awk -F'\t' '{ printf "    | %s %s %s %s %s\n", $1, $2, $3, $4, $5 }' | tee -a "${AD8_NOTES:-/dev/null}"
  local new_sid new_short
  new_short=$(echo "$sessions" | awk -F'\t' -v id="$short" '$1 == id { print $1 }')
  new_sid=$(echo "$sessions" | awk -F'\t' -v id="$short" '$1 == id { print $2 }')
  if [[ -z $new_sid ]]; then new_sid=$AD8_SID; fi
  say "continued: PR_OPENED $([[ -e $AD8_SCRATCH/PR_OPENED ]] && echo yes || echo no)"
  say "session id: $([[ $new_sid == "$AD8_SID" ]] && echo same || echo different)"
  say "short id: $([[ $short == "$AD8_SHORT" ]] && echo same || echo new)"
  say "name: $(echo "$sessions" | awk -F'\t' -v id="$short" '$1 == id { print $5 }')"
  say "bridgeSessionId present: $(node "$AD8_COMMON/jobstate.mjs" "$short" bridge); same as before: $([[ $(node "$AD8_COMMON/jobstate.mjs" "$short" bridgehash) == "$AD8_BRIDGE0" ]] && echo same || echo different)"
  say "respawnFlags now: $(node "$AD8_COMMON/jobstate.mjs" "$short" flags)"
  say "background command running: $(ad8_bg_running)"
  say "hooks (time, event, session id, source/reason, permission mode), after the kill:"
  node -e '
    const [file, since] = process.argv.slice(1);
    const lines = require("fs").existsSync(file) ? require("fs").readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
    for (const l of lines) { const e = JSON.parse(l);
      console.log(`    | ${e.time.slice(11, 19)} ${e.event} ${String(e.session_id).slice(0, 8)} ${e.source ?? e.reason ?? ""} ${e.permission_mode ?? ""}${e.time > since ? "  (after kill)" : ""}`); }
  ' "$AD8_HOOKS" "$AD8_KILLED_AT" | tee -a "${AD8_NOTES:-/dev/null}"
  local f
  for f in "$(ad8_projects_dir)"/*.jsonl; do
    [[ -e $f ]] || continue
    say "transcript $(basename "$f" .jsonl | cut -c1-8) ($(wc -l <"$f") lines):"
    node "$AD8_COMMON/inspect.mjs" "$f" | sed 's/^/    | /' | tee -a "${AD8_NOTES:-/dev/null}"
  done
  local last
  last=$(node "$AD8_COMMON/inspect.mjs" "$(ad8_transcript "$new_sid")" | grep '^last assistant text')
  say "codeword remembered: $([[ $last == *"$AD8_CODEWORD"* ]] && echo yes || echo no)"
  say "summary: continued=$([[ -e $AD8_SCRATCH/PR_OPENED ]] && echo yes || echo no) session=$([[ $new_sid == "$AD8_SID" ]] && echo same || echo different) short=$([[ $short == "$AD8_SHORT" ]] && echo same || echo new) codeword=$([[ $last == *"$AD8_CODEWORD"* ]] && echo yes || echo no) background_running=$(ad8_bg_running)"
}

# Stops and removes every agent session started in the scratch directory, kills
# the leftover background commands, and deletes the scratch directory.
ad8_cleanup() {
  [[ $AD8_KEEP == 1 ]] && {
    say "AD8_KEEP=1: leaving $AD8_SCRATCH and its agent sessions"
    return 0
  }
  local id
  for id in $(ad8_mine | cut -f1); do
    cc stop "$id" >/dev/null 2>&1
    cc rm "$id" >/dev/null 2>&1
  done
  pkill -f "$AD8_BGMARK" 2>/dev/null
  pkill -f "$AD8_FGMARK" 2>/dev/null
  rm -rf "$AD8_SCRATCH" "$(ad8_projects_dir)"
  say "cleaned up; agent sessions left in the scratch directory: $(ad8_mine | wc -l)"
}
