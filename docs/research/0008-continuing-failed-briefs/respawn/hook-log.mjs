// Appends one JSON line per hook event to hooks.jsonl in the agent session's cwd.
// Usage in settings.json: node hook-log.mjs <EventName>
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

const event = process.argv[2];
let input = {};
try {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  input = JSON.parse(raw);
} catch {}
const line = {
  event,
  session_id: input.session_id,
  time: new Date().toISOString(),
  ...(event === 'Stop' ? { stop_hook_active: input.stop_hook_active } : {}),
  ...(event === 'SessionStart' ? { source: input.source } : {}),
  ...(event === 'SessionEnd' ? { reason: input.reason } : {}),
  permission_mode: input.permission_mode,
  pid: process.ppid,
};
appendFileSync(
  join(input.cwd ?? process.cwd(), 'hooks.jsonl'),
  JSON.stringify(line) + '\n',
);
