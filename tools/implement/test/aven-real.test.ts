import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { cliAven } from '../src/aven.ts';
import { avenConfig } from '../src/config.ts';
import type { Config } from '../src/config.ts';
import type { State } from '../src/state.ts';
import { tick } from '../src/tick.ts';

// These run the real `aven`, when it's installed, against a scratch database
// and config in a temporary folder, so they never touch the host's tasks. CI
// has no `aven`, so they're skipped there, and test/aven.test.ts covers
// parsing with captured output and the arguments with a fake.
const avenBin = installedAven();
const skip = avenBin ? false : 'aven is not installed';

function installedAven(): string | undefined {
  const bin = avenConfig().avenBin;
  return spawnSync(bin, ['--version']).status === 0 ? bin : undefined;
}

/**
 * The environment for a test that runs `aven`, built from nothing instead of
 * from `process.env`. The database, config, and home folder are temporary, and
 * sync and update checks are off.
 */
function scratchAven(t: TestContext) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'implement-aven-real-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: path.join(dir, 'home'),
    AVEN_DB: path.join(dir, 'aven.db'),
    AVEN_CONFIG_DIR: path.join(dir, 'config'),
    AVEN_NO_UPDATE_CHECK: '1',
    AVEN_SYNC_DISABLED: '1',
  };
  mkdirSync(env.HOME!);
  const aven = (...args: string[]) =>
    execFileSync(avenBin!, args, { env, encoding: 'utf8' });
  aven('project', 'create', 'agent-diff');
  aven('project', 'create', 'other');
  /** Adds a task and returns its ID. */
  const add = (title: string, ...args: string[]) => {
    const ref = /^created (\S+)/.exec(aven('add', title, ...args))![1];
    return (JSON.parse(aven('show', ref, '--json')) as { id: string }).id;
  };
  const context = (id: string) =>
    JSON.parse(aven('context', id, '--json')) as {
      metadata: Record<string, string>;
      notes: { body: string }[];
    };
  return { env, aven, add, context };
}

/**
 * Runs one tick against the scratch `aven`, with fakes for everything else and
 * no agent sessions running. Returns the agent sessions it started and
 * resumed, and the state it left, which is `state` when given.
 */
function runTick(
  s: ReturnType<typeof scratchAven>,
  concurrency = 2,
  { state = { briefs: {} }, now = 0 }: { state?: State; now?: number } = {},
): {
  started: string[];
  resumed: { sessionId: string; prompt: string }[];
  state: State;
  logs: string[];
} {
  const config: Config = {
    repoDir: '/repo',
    repo: 'dan/agent-diff',
    author: 'dan',
    worktreesDir: '/repo/.claude/worktrees',
    stateDir: '/state',
    baseBranch: 'main',
    concurrency,
    claudeBin: 'claude',
    avenBin: avenBin!,
    avenProject: 'agent-diff',
  };
  const started: string[] = [];
  const resumed: { sessionId: string; prompt: string }[] = [];
  const logs: string[] = [];
  let suffixes = 0;
  tick({
    config,
    aven: cliAven(avenBin!, 'agent-diff', s.env),
    github: { pullRequestForBranch: () => undefined },
    git: { addWorktree() {}, removeWorktree() {}, prune() {} },
    claude: {
      start: (o) => started.push(o.name),
      resume: (_cwd, sessionId, prompt) => resumed.push({ sessionId, prompt }),
      running: () => [],
      stop() {},
      logTail: () => '',
    },
    state,
    settingsFile: '/state/settings.json',
    randomSuffix: () => `r${++suffixes}`,
    now: () => now,
    sleep() {},
    log: (m) => logs.push(m),
  });
  return { started, resumed, state, logs };
}

/** Waits until the clock is in the next second, since `aven` times notes to the second. */
function sleepPastSecond() {
  const second = Math.floor(Date.now() / 1000);
  while (Math.floor(Date.now() / 1000) === second)
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
}

const BODY =
  '### Goal\n\nDo it.\n\n### Acceptance criteria\n\n- It works.\n\n### Verification\n\nRun it.\n';

test('lists only open tasks queued in the project', { skip }, (t) => {
  const s = scratchAven(t);
  const first = s.add(
    'First',
    '--project',
    'agent-diff',
    '--metadata',
    'agent=queued',
    '--description',
    BODY,
  );
  const second = s.add(
    'Second',
    '--project',
    'agent-diff',
    '--metadata',
    'agent=queued',
    '--status',
    'active',
  );
  s.add('Other project', '--project', 'other', '--metadata', 'agent=queued');
  s.add(
    'Canceled',
    '--project',
    'agent-diff',
    '--metadata',
    'agent=queued',
    '--status',
    'canceled',
  );
  s.add(
    'Done',
    '--project',
    'agent-diff',
    '--metadata',
    'agent=queued',
    '--status',
    'done',
  );
  s.add('Draft', '--project', 'agent-diff');
  s.add('Working', '--project', 'agent-diff', '--metadata', 'agent=working');

  const tasks = cliAven(avenBin!, 'agent-diff', s.env).queuedTasks();
  assert.deepEqual(tasks.map((task) => task.id).sort(), [first, second].sort());
  const task = tasks.find((x) => x.id === first)!;
  assert.match(task.ref, /^AD-/);
  assert.equal(task.title, 'First');
  assert.equal(task.description, BODY);
  assert.equal(task.status, 'inbox');
  assert.equal(task.agent, 'queued');
});

test('reads, edits, and notes a task by its ID', { skip }, (t) => {
  const s = scratchAven(t);
  const id = s.add(
    'Brief',
    '--project',
    'agent-diff',
    '--metadata',
    'agent=queued',
  );
  const aven = cliAven(avenBin!, 'agent-diff', s.env);

  aven.edit(id, { status: 'active', agent: 'working' });
  assert.deepEqual(
    { status: aven.task(id).status, agent: aven.task(id).agent },
    { status: 'active', agent: 'working' },
  );
  aven.edit(id, { status: 'done', agent: null });
  assert.equal(aven.task(id).status, 'done');
  assert.equal(aven.task(id).agent, undefined);
  assert.deepEqual(s.context(id).metadata, {});

  aven.note(id, 'Line one\n\n`code` and "quotes"');
  assert.deepEqual(
    s.context(id).notes.map((n) => n.body),
    ['Line one\n\n`code` and "quotes"'],
  );
});

test(
  "returns each note's ID, and reads a task's notes oldest first",
  { skip },
  (t) => {
    const s = scratchAven(t);
    const id = s.add('Brief', '--project', 'agent-diff');
    const aven = cliAven(avenBin!, 'agent-diff', s.env);
    // Notes added in the same second are ordered by ID, so each is added in a
    // later second than the one before.
    const ids = ['First', 'Second\n\nwith lines', 'Third'].map((body, i) => {
      if (i > 0) sleepPastSecond();
      return aven.note(id, body);
    });
    assert.equal(new Set(ids).size, 3);
    assert.deepEqual(
      aven.task(id).notes.map((n) => [n.id, n.body]),
      [
        [ids[0], 'First'],
        [ids[1], 'Second\n\nwith lines'],
        [ids[2], 'Third'],
      ],
    );
  },
);

test('lists only open tasks with agent=retry in the project', { skip }, (t) => {
  const s = scratchAven(t);
  const retry = s.add(
    'Retry',
    '--project',
    'agent-diff',
    '--metadata',
    'agent=retry',
  );
  s.add('Other project', '--project', 'other', '--metadata', 'agent=retry');
  s.add(
    'Canceled',
    '--project',
    'agent-diff',
    '--metadata',
    'agent=retry',
    '--status',
    'canceled',
  );
  s.add('Queued', '--project', 'agent-diff', '--metadata', 'agent=queued');

  const tasks = cliAven(avenBin!, 'agent-diff', s.env).retryTasks();
  assert.deepEqual(
    tasks.map((task) => task.id),
    [retry],
  );
  assert.match(tasks[0].ref, /^AD-/);
});

test(
  'a tick starts a queued brief and sends back one missing required fields',
  { skip },
  (t) => {
    const s = scratchAven(t);
    const ready = s.add(
      'Ready brief',
      '--project',
      'agent-diff',
      '--metadata',
      'agent=queued',
      '--description',
      BODY,
    );
    const draft = s.add(
      'Draft brief',
      '--project',
      'agent-diff',
      '--metadata',
      'agent=queued',
      '--description',
      '### Goal\n\nDo it.',
    );
    const { started, state } = runTick(s);

    assert.deepEqual(started, ['brief-ready-brief-r1']);
    const task = cliAven(avenBin!, 'agent-diff', s.env).task(ready);
    assert.equal(task.status, 'active');
    assert.equal(task.agent, 'working');
    assert.deepEqual(Object.keys(state.briefs), [ready]);

    const sentBack = s.context(draft);
    assert.deepEqual(sentBack.metadata, {});
    assert.match(
      sentBack.notes[0].body,
      /- Acceptance criteria\n- Verification/,
    );
  },
);

test(
  "reads a task's blockers, in any project, with their status and whether they're deleted",
  { skip },
  (t) => {
    const s = scratchAven(t);
    const open = s.add('Open', '--project', 'other', '--status', 'todo');
    const done = s.add('Done', '--project', 'agent-diff', '--status', 'done');
    const canceled = s.add(
      'Canceled',
      '--project',
      'agent-diff',
      '--status',
      'canceled',
    );
    const deleted = s.add('Deleted', '--project', 'agent-diff');
    const brief = s.add(
      'Brief',
      '--project',
      'agent-diff',
      '--metadata',
      'agent=queued',
    );
    for (const blocker of [open, done, canceled, deleted])
      s.aven('dep', 'add', brief, blocker);
    s.aven('delete', deleted);

    const blockers = cliAven(avenBin!, 'agent-diff', s.env).task(
      brief,
    ).blockers;
    const byId = new Map(blockers.map((b) => [b.id, b]));
    assert.equal(blockers.length, 4);
    assert.match(byId.get(open)!.ref, /^OTH-/);
    assert.equal(byId.get(open)!.title, 'Open');
    assert.deepEqual(
      [open, done, canceled, deleted].map((id) => [
        byId.get(id)!.status,
        byId.get(id)!.deleted,
      ]),
      [
        ['todo', false],
        ['done', false],
        ['canceled', false],
        ['inbox', true],
      ],
    );
  },
);

test(
  'a tick starts a brief only once its blockers are done, and sends it back when one is canceled',
  { skip },
  (t) => {
    const s = scratchAven(t);
    const queued = [
      '--project',
      'agent-diff',
      '--metadata',
      'agent=queued',
      '--description',
      BODY,
    ];
    const a = s.add('Brief A', ...queued);
    const b = s.add('Brief B', ...queued);
    const c = s.add('Brief C', ...queued);
    s.aven('dep', 'add', b, a);
    const refOf = (id: string) =>
      cliAven(avenBin!, 'agent-diff', s.env).task(id).ref;

    // A and C start together, and B waits on A, using no slot.
    const first = runTick(s, 3);
    assert.deepEqual(first.started, ['brief-brief-a-r1', 'brief-brief-c-r2']);
    assert.deepEqual(Object.keys(first.state.briefs).sort(), [a, c].sort());
    assert.ok(
      first.logs.includes(`${refOf(b)}: waiting on ${refOf(a)}`),
      first.logs.join('\n'),
    );
    assert.equal(s.context(b).metadata.agent, 'queued');
    assert.deepEqual(s.context(b).notes, []);

    // Once A is done, B starts.
    s.aven('edit', a, '--status', 'done');
    assert.deepEqual(runTick(s).started, ['brief-brief-b-r1']);

    // With A canceled instead, B is sent back with a note.
    s.aven('edit', b, '--metadata', 'agent=queued');
    s.aven('edit', a, '--status', 'canceled');
    assert.deepEqual(runTick(s).started, []);
    const sentBack = s.context(b);
    assert.deepEqual(sentBack.metadata, {});
    assert.match(
      sentBack.notes[0].body,
      new RegExp(`aven dep remove ${refOf(b)} ${refOf(a)}`),
    );
  },
);

test(
  "a tick marks a brief failed, recording its note's ID, and a later tick retries it with Dan's notes",
  { skip },
  (t) => {
    const s = scratchAven(t);
    const id = s.add(
      'Brief',
      '--project',
      'agent-diff',
      '--status',
      'active',
      '--metadata',
      'agent=working',
    );
    const untracked = s.add(
      'Never started',
      '--project',
      'agent-diff',
      '--metadata',
      'agent=retry',
    );
    s.aven('note', id, 'Before it failed.');
    const state: State = {
      briefs: {
        [id]: {
          taskId: id,
          ref: 'AD-OLD',
          repo: 'dan/agent-diff',
          title: 'Brief',
          branch: 'brief/brief-x1',
          worktree: '/repo/.claude/worktrees/brief-brief-x1',
          sessionName: 'brief-brief-x1',
          sessionId: 'session-x1',
          launchedAt: 0,
          handledReviewIds: [],
        },
      },
    };
    const later = 10 * 60 * 1000;

    // The agent session is gone, so the brief is marked failed.
    sleepPastSecond();
    runTick(s, 2, { state, now: later });
    const failed = s.context(id);
    assert.equal(failed.metadata.agent, 'failed');
    const failureNote = cliAven(avenBin!, 'agent-diff', s.env)
      .task(id)
      .notes.at(-1)!;
    assert.match(failureNote.body, /set `agent=retry`/);
    assert.equal(state.briefs[id].failureNoteId, failureNote.id);

    // The untracked task had agent=retry removed, with a note.
    assert.deepEqual(s.context(untracked).metadata, {});
    assert.match(s.context(untracked).notes[0].body, /nothing to retry/);

    // Dan adds a note and retries it.
    sleepPastSecond();
    s.aven('note', id, 'Use the other parser.');
    s.aven('edit', id, '--metadata', 'agent=retry');
    const { resumed } = runTick(s, 2, { state, now: later });
    assert.equal(resumed.length, 1);
    assert.equal(resumed[0].sessionId, 'session-x1');
    assert.match(resumed[0].prompt, /Use the other parser\./);
    assert.doesNotMatch(
      resumed[0].prompt,
      /Before it failed|End of the agent session/,
    );
    const retried = s.context(id);
    assert.equal(retried.metadata.agent, 'working');
    // Added in the same second as Dan's note, so it may come before it.
    assert.ok(
      retried.notes.some(
        (n) =>
          n.body ===
          'Retried: resumed the agent session `brief-brief-x1` where it stopped, with 1 note added since it failed.',
      ),
    );
  },
);
