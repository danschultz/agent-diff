#!/bin/sh
# Type-checks one example directory with the TypeScript in tools/node_modules.
S=$(cd "$(dirname "$0")/.." && pwd)
cd "$1" && printf '{ "extends": "%s/tsconfig.base.json", "include": ["*.ts", "shared/*.ts"] }\n' "$S" > tsconfig.json && "$S/tools/node_modules/.bin/tsc" -p . && echo "tsc: ok"
