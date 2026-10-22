// Appends one JSON line per hook event to the log file given as the first
// argument. Keeps only the event name, agent session id and a few flags.
import { appendFileSync } from 'node:fs';

let input = '';
for await (const chunk of process.stdin) input += chunk;
let e = {};
try {
  e = JSON.parse(input);
} catch {
  // Log the line anyway, so a bad payload shows up.
}
appendFileSync(
  process.argv[2],
  JSON.stringify({
    t: new Date().toISOString(),
    event: e.hook_event_name,
    session_id: e.session_id,
    stop_hook_active: e.stop_hook_active,
    reason: e.reason,
    source: e.source,
    notification_type: e.notification_type,
  }) + '\n',
);
