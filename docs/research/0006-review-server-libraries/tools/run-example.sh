#!/bin/sh
# Starts an example's server with $NODE (default node), runs its client, and stops the server.
# Usage: run-example.sh <dir> [server file] [client file]
N24=${NODE:-node}
cd "$1"; export PORT=${PORT:-4400}; export AGENT_DIFF_TOKEN=dev-token
$N24 ${2:-server.ts} > server.log 2>&1 & pid=$!
for i in $(seq 1 100); do curl -s -o /dev/null -H "authorization: Bearer dev-token" http://127.0.0.1:$PORT/api/health && break; sleep 0.1; done
$N24 ${3:-client.ts}; status=$?
kill $pid; wait $pid 2>/dev/null; exit $status
