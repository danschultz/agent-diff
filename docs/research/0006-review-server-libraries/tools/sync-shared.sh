#!/bin/sh
# Copies the shared files into every example, so imports resolve from the
# example's own node_modules.
S=$(cd "$(dirname "$0")/.." && pwd)
for d in "$S"/server/*/; do
  rm -rf "$d/shared"; cp -r "$S/shared" "$d/shared"
  # An example can replace the shared schemas, as orpc-valibot does.
  [ -f "$d/schemas.ts" ] && cp "$d/schemas.ts" "$d/shared/schemas.ts"
done
for d in "$S"/validate/*/; do [ "$d" = "$S/validate/harness/" ] || cp "$S"/validate/harness/*.ts "$d"; done
for d in "$S"/sqlite/*/; do cp "$S/sqlite/workload.ts" "$d"; done
for d in "$S"/query/*/; do cp "$S"/query/schema.sql "$S"/query/*.ts "$d"; done
