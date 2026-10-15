#!/bin/sh
# Prints the raw HTTP status and body for create and an invalid comment, per example.
N24=${NODE:-node}
S=$(cd "$(dirname "$0")/.." && pwd); H='authorization: Bearer dev-token'; J='content-type: application/json'
for name in node-http hono fastify express h3 elysia trpc orpc; do
  cd "$S/server/$name"; export PORT=4410
  $N24 server.ts > server.log 2>&1 & pid=$!
  for i in $(seq 1 100); do curl -s -o /dev/null -H "$H" http://127.0.0.1:$PORT/api/health && break; sleep 0.1; done
  echo "== $name"
  if [ $name = trpc ]; then
    out=$(curl -s -w '\n%{http_code}' -H "$H" -H "$J" -d '{"workingDirectories":["/repo/a"]}' http://127.0.0.1:$PORT/api/reviewSessions.create)
    id=$(echo "$out" | head -1 | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["data"]["id"])')
    echo "create: $(echo "$out" | tail -1)"
    curl -s -w '\n%{http_code}\n' -H "$H" -H "$J" -d "{\"id\":\"$id\",\"comment\":{\"path\":\"src/a.ts\",\"startLine\":5,\"endLine\":2,\"body\":\"\"}}" http://127.0.0.1:$PORT/api/reviewSessions.addComment
    curl -s -w '\n%{http_code}\n' -H "$H" "http://127.0.0.1:$PORT/api/reviewSessions.get?input=%7B%22id%22%3A%22nope%22%7D"
  else
    out=$(curl -s -w '\n%{http_code}' -H "$H" -H "$J" -d '{"workingDirectories":["/repo/a"]}' http://127.0.0.1:$PORT/api/review-sessions)
    id=$(echo "$out" | head -1 | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
    echo "create: $(echo "$out" | tail -1)"
    curl -s -w '\n%{http_code}\n' -H "$H" -H "$J" -d '{"path":"src/a.ts","startLine":5,"endLine":2,"body":""}' http://127.0.0.1:$PORT/api/review-sessions/$id/comments
    curl -s -w '\n%{http_code}\n' -H "$H" http://127.0.0.1:$PORT/api/review-sessions/nope
  fi
  curl -s -w '\n%{http_code}\n' -H "$H" -H "$J" -d 'not json' http://127.0.0.1:$PORT/api/review-sessions
  kill $pid; wait $pid 2>/dev/null
done
