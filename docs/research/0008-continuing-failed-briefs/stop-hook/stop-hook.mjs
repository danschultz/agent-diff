// A Stop hook that keeps an agent session from ending its work without a pull
// request. It also logs every hook event it is registered for, one JSON line
// each, so the experiments can see what fired and why a stop was allowed.
//
// Usage (in the settings file's hooks): node stop-hook.mjs --log <file>
//   [--max-blocks 3] [--marker PR_OPENED] [--needs-input NEEDS_INPUT]
//   [--question on|off] [--background input|jobstate|off]
//   [--daemon-blocked on|off] [--state-dir <dir>]
//
// Policy on Stop, first match wins:
//   pr          the marker file exists in the agent session's cwd: allow
//   needs-input the needs-input file exists: allow
//   question    the last assistant message ends with "?": allow
//   daemon      the daemon already set the job's state to "blocked" (its own
//               reading of the last message; internals; off by default)
//   background  background work is still running, which will wake the agent
//               session later anyway: allow
//   limit       this agent session has been blocked --max-blocks times: allow
//   (otherwise) block, with a reason saying what is left, and count the block
//
// SubagentStop is only logged, never blocked, so a sub-agent such as the
// self-review one can finish.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const logFile = opt('log');
const maxBlocks = Number(opt('max-blocks', '3'));
const marker = opt('marker', 'PR_OPENED');
const needsInput = opt('needs-input', 'NEEDS_INPUT');
const questionMode = opt('question', 'on');
const backgroundMode = opt('background', 'input');
const daemonBlocked = opt('daemon-blocked', 'off');

const REASON =
  'No pull request yet. Finish the remaining verification steps, self-review, push and open the draft pull request, or ask Dan if you are blocked.';

let raw = '';
for await (const chunk of process.stdin) raw += chunk;
let e = {};
try {
  e = JSON.parse(raw);
} catch {
  // Logged below with no fields, so a bad payload shows up.
}

const log = (extra = {}) => {
  if (!logFile) return;
  appendFileSync(
    logFile,
    JSON.stringify({
      t: new Date().toISOString(),
      event: e.hook_event_name,
      sid: String(e.session_id ?? '').slice(0, 8),
      stop_hook_active: e.stop_hook_active,
      agent_id: e.agent_id ? String(e.agent_id).slice(0, 8) : undefined,
      agent_type: e.agent_type,
      notification_type: e.notification_type,
      source: e.source,
      reason: e.reason,
      error: e.error,
      ...extra,
    }) + '\n',
  );
};

/** The job's inFlight from ~/.claude/jobs/<short-id>/state.json. Daemon internals. */
function jobInFlight(sessionId) {
  const jobs = path.join(process.env.HOME ?? os.homedir(), '.claude', 'jobs');
  try {
    for (const short of readdirSync(jobs)) {
      try {
        const s = JSON.parse(
          readFileSync(path.join(jobs, short, 'state.json'), 'utf8'),
        );
        if (s.sessionId === sessionId) {
          const fan = (s.fan ?? []).filter((f) => !f.doneAt).map((f) => f.kind);
          return {
            tasks: s.inFlight?.tasks ?? 0,
            kinds: s.inFlight?.kinds ?? [],
            fanRunning: fan,
            state: s.state,
            tempo: s.tempo,
          };
        }
      } catch {
        // Not a job directory with a readable state.json.
      }
    }
  } catch {
    // No jobs directory.
  }
  return undefined;
}

if (e.hook_event_name !== 'Stop') {
  log(
    e.hook_event_name === 'SubagentStop'
      ? { last_msg_len: (e.last_assistant_message ?? '').length }
      : {},
  );
  process.exit(0);
}

const cwd = e.cwd ?? process.cwd();
const last = String(e.last_assistant_message ?? '').trim();
const tasks = Array.isArray(e.background_tasks)
  ? e.background_tasks
  : undefined;
const running =
  tasks?.filter((t) => t.status === 'running' || t.status === 'pending') ?? [];
const job = jobInFlight(e.session_id);
const stateDir = opt('state-dir', path.join(cwd, '.stop-hook'));
mkdirSync(stateDir, { recursive: true });
const countFile = path.join(stateDir, `blocks-${e.session_id}`);
const blocks = existsSync(countFile)
  ? Number(readFileSync(countFile, 'utf8')) || 0
  : 0;

const facts = {
  blocks_so_far: blocks,
  ends_with_q: last.endsWith('?'),
  last_msg_len: last.length,
  input_fields: Object.keys(e).sort().join(','),
  bg_input: tasks
    ? tasks.map((t) => `${t.type}:${t.status}`).join('|') || 'empty'
    : 'absent',
  crons: Array.isArray(e.session_crons) ? e.session_crons.length : 'absent',
  bg_jobstate: job
    ? `tasks=${job.tasks} kinds=${job.kinds.join('|')} fan=${job.fanRunning.join('|')} state=${job.state}`
    : 'none',
};

let allow;
if (existsSync(path.join(cwd, marker))) allow = 'pr';
else if (existsSync(path.join(cwd, needsInput))) allow = 'needs-input';
else if (questionMode === 'on' && last.endsWith('?')) allow = 'question';
else if (daemonBlocked === 'on' && job?.state === 'blocked')
  allow = 'daemon-blocked';
else if (backgroundMode === 'input' && running.length > 0) allow = 'background';
else if (
  backgroundMode === 'jobstate' &&
  job &&
  (job.tasks > 0 || job.fanRunning.length > 0)
)
  allow = 'background';
else if (blocks >= maxBlocks) allow = 'limit';

if (allow) {
  log({ decision: 'allow', why: allow, ...facts });
  process.exit(0);
}
writeFileSync(countFile, String(blocks + 1));
log({ decision: 'block', why: 'no-pr', ...facts, blocks_now: blocks + 1 });
process.stdout.write(JSON.stringify({ decision: 'block', reason: REASON }));
