#!/usr/bin/env bash
# Option bg-resume: continue an agent session whose worker was killed with
# `claude --bg --resume <session-id> "<prompt>"`, the command implement runs to
# resume an agent session for a review.
#
# Usage: ./run.sh [plain|startflags]
#   plain       (default) no other flags, as implement's resume() does
#   startflags  also pass implement's start flags again
# Environment: AD8_MODE=idle|midturn|stop|midturn-stop, AD8_KILL=repl|host, AD8_NOTES=<file>,
#   AD8_KEEP=1. See ../common/lib.sh.
set -u
variant=${1:-plain}
export AD8_OPTION=bg-resume
if [[ -z ${AD8_N:-} ]]; then
  case "${AD8_MODE:-idle}:$variant" in
    idle:plain) AD8_N=1 ;;
    idle:startflags) AD8_N=2 ;;
    stop:*) AD8_N=3 ;;
    midturn:*) AD8_N=4 ;;
    midturn-stop:*) AD8_N=6 ;;
    *) AD8_N=5 ;;
  esac
  export AD8_N
fi
source "$(dirname "$0")/../common/lib.sh"

ad8_setup || { ad8_cleanup; exit 1; }

before=$(ad8_mine | cut -f1 | sort | paste -sd, -)
say "continuing ($variant): claude --bg --resume $AD8_SID"
extra=()
if [[ $variant == startflags ]]; then
  extra=(--remote-control "$AD8_NAME" --name "$AD8_NAME" --permission-mode auto --settings "$AD8_SCRATCH/settings.json")
fi
out=$(cd "$AD8_SCRATCH" && cc --bg --resume "$AD8_SID" "${extra[@]}" "$AD8_CONTINUE_PROMPT" 2>&1)
echo "$out" | sed 's/^/    | /' | tee -a "${AD8_NOTES:-/dev/null}"
short=$(echo "$out" | grep -oE 'backgrounded · [0-9a-f]{8}' | grep -oE '[0-9a-f]{8}$')
say "agent sessions in the scratch directory before: $before; after: $(ad8_mine | cut -f1 | sort | paste -sd, -)"
say "command printed short id: ${short:-none}"
if [[ -n $short ]]; then ad8_wait_continued "$short"; fi
ad8_report "${short:-$AD8_SHORT}"
say "daemon.log lines since the kill:"
tail -n +"$((AD8_LOG0 + 1))" "$AD8_DAEMON_LOG" | sed 's/^/    | /' | tee -a "${AD8_NOTES:-/dev/null}"
ad8_cleanup
