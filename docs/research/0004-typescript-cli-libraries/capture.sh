#!/bin/bash
# Runs one example with stdout and stderr redirected to files, so neither is a TTY.
# Usage: ./capture.sh <example> <label> [args...]
# Writes out/<example>/<label>.stdout, .stderr, and .exit next to this script.
here=$(cd "$(dirname "$0")" && pwd)
example=$1; label=$2; shift 2
out=$here/out/$example
mkdir -p "$out"
cd "$here/$example" && node cli.ts "$@" >"$out/$label.stdout" 2>"$out/$label.stderr" </dev/null
echo $? >"$out/$label.exit"
