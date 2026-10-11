// Simulates agent write patterns against a workspace that's in an open review session,
// and measures how the watcher coalesces them and how long until the server reports them.
//
// Usage: npm run burst [-- --repo <path>] [--only <scenario,...>] [--files 200] [--quiet-ms 1500]
//
// Without --repo it targets prototype/.data/demo-repo. Scenarios that run git commands
// (index, checkout) only run against the demo repo unless you pass --allow-git, and the
// file scenarios only touch an `agent-diff-burst/` directory that's removed afterwards.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { dataDir, serverInfoFile, type ServerInfo } from '../src/shared/paths.ts';
import type { ReviewSessionInfo, WorkspaceChangedEvent } from '../src/shared/types.ts';

const { values } = parseArgs({
  options: {
    repo: { type: 'string' },
    only: { type: 'string' },
    files: { type: 'string', default: '200' },
    'quiet-ms': { type: 'string', default: '1500' },
    'allow-git': { type: 'boolean', default: false },
  },
});

const demoRepo = path.join(dataDir, 'demo-repo');
const repoArg = path.resolve(values.repo ?? demoRepo);
if (!existsSync(repoArg)) {
  console.error(`${repoArg} doesn't exist. Run \`npm run demo-repo\` first or pass --repo.`);
  process.exit(1);
}
const root = realpathSync(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: repoArg, encoding: 'utf8' }).trim());
const isDemo = root === realpathSync(path.resolve(demoRepo)) || (existsSync(demoRepo) && root === realpathSync(demoRepo));
const allowGit = values['allow-git'] || isDemo;
const fileCount = Number(values.files);
const quietMs = Number(values['quiet-ms']);
const scratch = path.join(root, 'agent-diff-burst');

if (!existsSync(serverInfoFile)) {
  console.error('No review server is running. Start one with `agent-diff start` in the repo.');
  process.exit(1);
}
const server = JSON.parse(readFileSync(serverInfoFile, 'utf8')) as ServerInfo;
const state = (await (await fetch(`${server.url}/api/state`)).json()) as { reviewSessions: ReviewSessionInfo[] };
const workspace = state.reviewSessions
  .filter((rs) => rs.status === 'open')
  .flatMap((rs) => rs.workspaces)
  .find((w) => w.root === root);
if (!workspace) {
  console.error(`${root} isn't in an open review session. Run \`agent-diff start\` there first.`);
  process.exit(1);
}

interface Received {
  event: WorkspaceChangedEvent;
  receivedAt: number;
}
let received: Received[] = [];
const abort = new AbortController();
const ready = subscribe(abort.signal);

interface Scenario {
  name: string;
  description: string;
  git?: boolean;
  expectEvents: boolean;
  setup?: () => void;
  run: () => Promise<void> | void;
  cleanup?: () => void;
}

const branch = () => execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim();
const run = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const scratchFile = (i: number) => path.join(scratch, `dir-${i % 10}`, `file-${i}.ts`);

const scenarios: Scenario[] = [
  {
    name: 'single-edit',
    description: 'One file written once.',
    expectEvents: true,
    setup: () => mkdirSync(scratch, { recursive: true }),
    run: () => writeFileSync(path.join(scratch, 'single.ts'), `export const at = ${Date.now()};\n`),
  },
  {
    name: 'many-files',
    description: `${fileCount} new files written back to back, like a scaffold or codegen step.`,
    expectEvents: true,
    run: () => {
      for (let i = 0; i < fileCount; i++) {
        mkdirSync(path.dirname(scratchFile(i)), { recursive: true });
        writeFileSync(scratchFile(i), `export const n = ${i};\n`);
      }
    },
  },
  {
    name: 'paced-edits',
    description: '20 edits to one file, 50 ms apart, like an agent applying a patch hunk by hunk.',
    expectEvents: true,
    run: async () => {
      for (let i = 0; i < 20; i++) {
        writeFileSync(path.join(scratch, 'paced.ts'), `export const step = ${i};\n`);
        await sleep(50);
      }
    },
  },
  {
    name: 'atomic-saves',
    description: '50 saves through a temp file and rename, like editors and some agent tools.',
    expectEvents: true,
    run: () => {
      for (let i = 0; i < 50; i++) {
        const target = path.join(scratch, 'atomic.ts');
        const tmp = path.join(scratch, `.atomic.ts.${i}.tmp`);
        writeFileSync(tmp, `export const save = ${i};\n`);
        renameSync(tmp, target);
      }
    },
  },
  {
    name: 'ignored-only',
    description: 'Writes only to gitignored paths. Expect no event.',
    expectEvents: false,
    run: () => {
      const dir = path.join(root, 'node_modules', '.agent-diff-burst');
      mkdirSync(dir, { recursive: true });
      for (let i = 0; i < 50; i++) writeFileSync(path.join(dir, `f${i}.js`), String(i));
      writeFileSync(path.join(root, 'agent-diff-burst.log'), 'log line\n');
    },
    cleanup: () => {
      rmSync(path.join(root, 'node_modules', '.agent-diff-burst'), { recursive: true, force: true });
      rmSync(path.join(root, 'agent-diff-burst.log'), { force: true });
    },
  },
  {
    name: 'stage-unstage',
    description: '`git add` then `git reset` on a scratch file. Expect gitMetadata events.',
    git: true,
    expectEvents: true,
    run: async () => {
      run('add', '--', path.relative(root, path.join(scratch, 'single.ts')));
      await sleep(300);
      run('reset', '-q', '--', path.relative(root, path.join(scratch, 'single.ts')));
    },
  },
  {
    name: 'checkout-roundtrip',
    description: 'Switch to the base branch and back, rewriting every file that differs.',
    git: true,
    expectEvents: true,
    run: async () => {
      const current = branch();
      if (!current) throw new Error('HEAD is detached; skipping.');
      run('switch', '-q', workspace.baseRef.replace(/^origin\//, ''));
      await sleep(300);
      run('switch', '-q', current);
    },
  },
  {
    name: 'cleanup',
    description: 'Remove the scratch directory.',
    expectEvents: true,
    run: () => rmSync(scratch, { recursive: true, force: true }),
  },
];

await ready;
const only = values.only?.split(',');
console.log(`Workspace ${root} (${workspace.id}), server ${server.url}`);
const settings = (await (await fetch(`${server.url}/api/settings`)).json()) as { debounceMs: number; maxWaitMs: number };
console.log(`Watcher settings: debounce ${settings.debounceMs} ms, max wait ${settings.maxWaitMs} ms\n`);

const rows: string[][] = [];
try {
  for (const s of scenarios) {
    if (only && !only.includes(s.name) && s.name !== 'cleanup') continue;
    if (s.git && !allowGit) {
      console.log(`- ${s.name}: skipped (runs git commands; pass --allow-git to run outside the demo repo)`);
      continue;
    }
    s.setup?.();
    await sleep(quietMs);
    received = [];
    const start = Date.now();
    try {
      await s.run();
    } catch (error) {
      console.log(`- ${s.name}: failed: ${(error as Error).message}`);
      s.cleanup?.();
      continue;
    }
    const lastWrite = Date.now();
    await waitForQuiet();
    s.cleanup?.();
    const events = received.filter((r) => r.event.workspaceId === workspace.id);
    const ok = s.expectEvents ? events.length > 0 : events.length === 0;
    const first = events[0];
    const last = events.at(-1);
    rows.push([
      ok ? 'ok' : 'UNEXPECTED',
      s.name,
      String(events.length),
      String(events.reduce((n, r) => n + r.event.rawEventCount, 0)),
      String(Math.max(0, ...events.map((r) => r.event.pathCount))),
      events.some((r) => r.event.gitMetadata) ? 'yes' : 'no',
      first ? `${first.receivedAt - start}` : '',
      last ? `${last.receivedAt - lastWrite}` : '',
      `${lastWrite - start}`,
    ]);
    console.log(`- ${s.name}: ${s.description}`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
  abort.abort();
}

console.log();
table(['', 'scenario', 'events', 'raw fs events', 'max paths/event', 'git metadata', 'first event (ms after first write)', 'settled (ms after last write)', 'write duration (ms)'], rows);
console.log(`
"settled" is when the last event for the scenario arrived, so it includes the debounce.
The UI's metrics panel shows the rest of the pipeline: refetch and repaint after each event.`);

async function waitForQuiet(): Promise<void> {
  let seen = -1;
  while (seen !== received.length) {
    seen = received.length;
    await sleep(quietMs);
  }
}

async function subscribe(signal: AbortSignal): Promise<void> {
  const res = await fetch(`${server.url}/api/events`, { signal });
  if (!res.body) throw new Error('No event stream');
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += value;
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const data = chunk
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trim())
            .join('\n');
          if (!data) continue;
          const event = JSON.parse(data) as { type: string };
          if (event.type === 'workspace-changed') received.push({ event: event as WorkspaceChangedEvent, receivedAt: Date.now() });
        }
      }
    } catch {
      // Aborted at exit.
    }
  })();
}

function table(head: string[], body: string[][]): void {
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((r) => r[i].length)));
  const line = (r: string[]) => r.map((c, i) => (i < 2 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ');
  console.log(line(head));
  for (const r of body) console.log(line(r));
}
