// Prints "<pid> <replPid>" for a worker in ~/.claude/daemon/roster.json.
// Usage: node roster.mjs <short-id>
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const short = process.argv[2];
const roster = JSON.parse(
  readFileSync(
    path.join(
      process.env.HOME ?? os.homedir(),
      '.claude',
      'daemon',
      'roster.json',
    ),
    'utf8',
  ),
);
const w = roster.workers?.[short];
console.log(w ? `${w.pid} ${w.replPid ?? '-'}` : '- -');
