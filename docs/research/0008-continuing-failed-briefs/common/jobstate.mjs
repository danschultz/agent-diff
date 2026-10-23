// Reads facts from ~/.claude/jobs/<short-id>/state.json without printing
// secrets. Usage: node jobstate.mjs <short-id> <what>
//   bridge      yes or no: is bridgeSessionId present
//   bridgehash  a short hash of bridgeSessionId, for comparing runs (not the value)
//   flags       respawnFlags as JSON
//   field:<k>   a plain field (state, name, sessionId, resumeSessionId, detail, ...)
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [short, what] = process.argv.slice(2);
let s;
try {
  s = JSON.parse(
    readFileSync(
      path.join(
        process.env.HOME ?? os.homedir(),
        '.claude',
        'jobs',
        short,
        'state.json',
      ),
      'utf8',
    ),
  );
} catch {
  console.log('(no state.json)');
  process.exit(0);
}
if (what === 'bridge') console.log(s.bridgeSessionId ? 'yes' : 'no');
else if (what === 'bridgehash')
  console.log(
    s.bridgeSessionId
      ? createHash('sha256').update(s.bridgeSessionId).digest('hex').slice(0, 8)
      : '-',
  );
else if (what === 'flags') console.log(JSON.stringify(s.respawnFlags ?? null));
else if (what.startsWith('field:'))
  console.log(JSON.stringify(s[what.slice(6)] ?? null));
