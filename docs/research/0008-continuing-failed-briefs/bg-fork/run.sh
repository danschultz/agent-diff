#!/usr/bin/env bash
# Option bg-fork: continue an agent session whose worker was killed with
# `claude --bg --resume <session-id> --fork-session "<prompt>"`, which copies
# the conversation into a new agent session with a new session ID.
#
# Usage: ./run.sh
# Environment: AD8_MODE=idle|midturn|stop|midturn-stop, AD8_KILL=repl|host, AD8_NOTES=<file>,
#   AD8_KEEP=1. See ../common/lib.sh.
set -u
export AD8_OPTION=bg-fork
source "$(dirname "$0")/../common/lib.sh"

ad8_setup || { ad8_cleanup; exit 1; }

before=$(ad8_mine | cut -f1 | sort | paste -sd, -)
say "continuing: claude --bg --resume $AD8_SID --fork-session"
out=$(cd "$AD8_SCRATCH" && cc --bg --resume "$AD8_SID" --fork-session "$AD8_CONTINUE_PROMPT" 2>&1)
echo "$out" | sed 's/^/    | /' | tee -a "${AD8_NOTES:-/dev/null}"
short=$(echo "$out" | grep -oE 'backgrounded · [0-9a-f]{8}' | grep -oE '[0-9a-f]{8}$')
say "agent sessions in the scratch directory before: $before; after: $(ad8_mine | cut -f1 | sort | paste -sd, -)"
say "command printed short id: ${short:-none}"
if [[ -n $short ]]; then ad8_wait_continued "$short"; fi
ad8_report "${short:-$AD8_SHORT}"
say "the original agent session now: $(ad8_mine | awk -F'\t' -v id="$AD8_SHORT" '$1 == id { printf "state=%s status=%s name=%s", $3, $4, $5 }')"
say "daemon.log lines since the kill:"
tail -n +"$((AD8_LOG0 + 1))" "$AD8_DAEMON_LOG" | sed 's/^/    | /' | tee -a "${AD8_NOTES:-/dev/null}"
ad8_cleanup
