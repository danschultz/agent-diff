// A hook that appends one JSON line per event to the log file given as the
// first argument. Used by the 0008 prototypes to see which hooks fire after an
// agent session is continued, and with which session ID.
import { appendFileSync } from 'node:fs';

const logFile = process.argv[2];
let input = '';
for await (const chunk of process.stdin) input += chunk;
let event = {};
try {
  event = JSON.parse(input);
} catch {
  // Log the line anyway, so a bad payload shows up.
}
appendFileSync(
  logFile,
  JSON.stringify({
    time: new Date().toISOString(),
    event: event.hook_event_name,
    session_id: event.session_id,
    stop_hook_active: event.stop_hook_active,
    permission_mode: event.permission_mode,
    source: event.source,
    reason: event.reason,
    transcript_path: event.transcript_path ? 'present' : undefined,
  }) + '\n',
);
