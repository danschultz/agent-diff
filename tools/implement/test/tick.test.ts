import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Aven, Task, TaskChanges } from '../src/aven.ts';
import type { AgentSessionInfo, Claude, StartOptions } from '../src/claude.ts';
import type { Config } from '../src/config.ts';
import type { GitHub, PullRequest } from '../src/github.ts';
import { onNotification, onPromptSubmit } from '../src/hook.ts';
import type { BriefState, State } from '../src/state.ts';
import { LAUNCH_GRACE_MS, tick, type Deps } from '../src/tick.ts';

const config: Config = {
  repoDir: '/repo',
  repo: 'dan/agent-diff',
  author: 'dan',
  worktreesDir: '/repo/.claude/worktrees',
  stateDir: '/state',
  baseBranch: 'main',
  concurrency: 2,
  claudeBin: 'claude',
  avenBin: 'aven',
  avenProject: 'agent-diff',
};

const BODY =
  '### Goal\n\nDo it.\n\n### Acceptance criteria\n\n- It works.\n\n### Verification\n\nRun it.';

/** A task in the fake Aven. Its ID and ref both contain `n`. */
function task(
  n: string,
  agent: string | undefined,
  extra: Partial<Task> = {},
): Task {
  return {
    id: `${n}TASKID0000`,
    ref: `AD-${n}`,
    title: `Brief ${n}`,
    description: BODY,
    status: 'active',
    agent,
    ...extra,
  };
}

function harness(
  options: {
    tasks?: Task[];
    prs?: Record<string, PullRequest>;
    running?: AgentSessionInfo[];
    state?: State;
    now?: number;
  } = {},
) {
  const tasks = new Map((options.tasks ?? []).map((t) => [t.id, t]));
  const prs = options.prs ?? {};
  const running = options.running ?? [];
  const notes: { id: string; body: string }[] = [];
  const edits: { id: string; changes: TaskChanges }[] = [];
  const started: StartOptions[] = [];
  const resumed: { cwd: string; sessionId: string; prompt: string }[] = [];
  const stopped: string[] = [];
  const removed: string[] = [];
  const added: { dir: string; branch: string }[] = [];
  const state: State = options.state ?? { briefs: {} };
  // Mirrors `aven list --project agent-diff --open --metadata agent=queued`.
  const aven: Aven = {
    queuedTasks: () =>
      structuredClone(
        [...tasks.values()].filter(
          (t) =>
            t.agent === 'queued' &&
            t.status !== 'done' &&
            t.status !== 'canceled',
        ),
      ),
    task: (id) => structuredClone(tasks.get(id)!),
    edit(id, changes) {
      edits.push({ id, changes });
      const t = tasks.get(id)!;
      if (changes.status) t.status = changes.status;
      if (changes.agent === null) t.agent = undefined;
      else if (changes.agent) t.agent = changes.agent;
    },
    note: (id, body) => notes.push({ id, body }),
  };
  const github: GitHub = {
    pullRequestForBranch: (branch) => prs[branch],
  };
  const claude: Claude = {
    start(o) {
      started.push(o);
      running.push({
        id: `id-${o.name}`,
        sessionId: `session-${o.name}`,
        cwd: o.cwd,
        state: 'working',
        name: o.name,
      });
    },
    resume: (cwd, sessionId, prompt) =>
      resumed.push({ cwd, sessionId, prompt }),
    running: () => running,
    stop: (id) => stopped.push(id),
    logTail: () => 'last words',
  };
  const now = options.now ?? 10 * LAUNCH_GRACE_MS;
  let suffixes = 0;
  const deps: Deps = {
    config,
    aven,
    github,
    git: {
      addWorktree: (dir, branch) => added.push({ dir, branch }),
      removeWorktree: (dir) => removed.push(dir),
      prune() {},
    },
    claude,
    state,
    settingsFile: '/state/settings.json',
    randomSuffix: () => `r${++suffixes}`,
    now: () => now,
    sleep() {},
    log() {},
  };
  return {
    deps,
    tasks,
    notes,
    edits,
    started,
    resumed,
    stopped,
    removed,
    added,
    state,
    running,
  };
}

function tracked(n: string, extra: Partial<BriefState> = {}): BriefState {
  return {
    taskId: `${n}TASKID0000`,
    ref: `AD-${n}`,
    repo: config.repo,
    title: `Brief ${n}`,
    branch: `brief/brief-${n}-x1`,
    worktree: `/repo/.claude/worktrees/brief-brief-${n}-x1`,
    sessionName: `brief-brief-${n}-x1`,
    sessionId: `session-${n}`,
    launchedAt: 0,
    handledReviewIds: [],
    ...extra,
  };
}

/** Tracked in state, keyed by its task's ID. */
function stateOf(...briefs: BriefState[]): State {
  return { briefs: Object.fromEntries(briefs.map((b) => [b.taskId, b])) };
}

function session(
  n: string,
  state: string,
  extra: Partial<AgentSessionInfo> = {},
): AgentSessionInfo {
  return {
    id: `id-${n}`,
    sessionId: `session-${n}`,
    cwd: tracked(n).worktree,
    state,
    ...extra,
  };
}

function pr(
  number: number,
  state: PullRequest['state'],
  extra: Partial<PullRequest> = {},
): PullRequest {
  return {
    number,
    url: `https://github.com/dan/agent-diff/pull/${number}`,
    state,
    reviews: [],
    ...extra,
  };
}

test('starts a queued brief in its own worktree, and sets it active and working', () => {
  const h = harness({ tasks: [task('7K', 'queued', { status: 'todo' })] });
  tick(h.deps);
  assert.deepEqual(h.added, [
    {
      dir: '/repo/.claude/worktrees/brief-brief-7k-r1',
      branch: 'brief/brief-7k-r1',
    },
  ]);
  assert.equal(h.started.length, 1);
  assert.equal(h.started[0].name, 'brief-brief-7k-r1');
  assert.equal(h.started[0].cwd, '/repo/.claude/worktrees/brief-brief-7k-r1');
  assert.equal(h.started[0].settingsFile, '/state/settings.json');
  assert.match(h.started[0].prompt, /Do it\./);
  assert.equal(h.tasks.get('7KTASKID0000')!.status, 'active');
  assert.equal(h.tasks.get('7KTASKID0000')!.agent, 'working');
  const brief = h.state.briefs['7KTASKID0000'];
  assert.equal(brief.ref, 'AD-7K');
  assert.equal(brief.branch, 'brief/brief-7k-r1');
  assert.equal(brief.sessionId, 'session-brief-brief-7k-r1');
});

test("branch, worktree, and agent session names don't contain the task's ref or ID", () => {
  const t = task('Q9ZZ', 'queued', {
    id: 'Q9ZZX4MV2P8D6R0A',
    ref: 'AD-Q9ZZ',
    title: 'Fix the parser',
  });
  const h = harness({ tasks: [t] });
  tick(h.deps);
  const brief = h.state.briefs[t.id];
  assert.equal(brief.branch, 'brief/fix-the-parser-r1');
  for (const name of [brief.branch, brief.worktree, brief.sessionName])
    assert.doesNotMatch(name, /q9zz|Q9ZZ/i);
});

test('sends back a queued brief with missing required fields, with a note listing them', () => {
  const h = harness({
    tasks: [
      task('3A', 'queued', {
        status: 'todo',
        description: '### Goal\n\nDo it.\n\n### Verification\n\n_No response_',
      }),
    ],
  });
  tick(h.deps);
  assert.equal(h.started.length, 0);
  assert.equal(h.tasks.get('3ATASKID0000')!.agent, undefined);
  assert.equal(h.tasks.get('3ATASKID0000')!.status, 'todo');
  assert.equal(h.notes.length, 1);
  assert.match(h.notes[0].body, /- Acceptance criteria\n- Verification/);
  assert.match(h.notes[0].body, /agent=queued/);
  assert.equal(h.state.briefs['3ATASKID0000'], undefined);
});

test("a brief sent back doesn't use a concurrency slot", () => {
  const h = harness({
    tasks: [
      task('1A', 'queued', { description: '### Goal\n\nDo it.' }),
      task('2A', 'queued'),
      task('3A', 'queued'),
    ],
  });
  tick(h.deps);
  assert.deepEqual(
    h.started.map((s) => s.name),
    ['brief-brief-2a-r1', 'brief-brief-3a-r2'],
  );
});

test('respects the concurrency limit, counting running agent sessions', () => {
  const h = harness({
    tasks: [task('1A', 'working'), task('2A', 'queued'), task('3A', 'queued')],
    state: stateOf(tracked('1A')),
    running: [session('1A', 'working')],
  });
  tick(h.deps);
  assert.deepEqual(
    h.started.map((s) => s.name),
    ['brief-brief-2a-r1'],
  );
  assert.equal(h.tasks.get('3ATASKID0000')!.agent, 'queued');
});

test('marks a brief failed when its agent session exits without a pull request', () => {
  const h = harness({
    tasks: [task('5A', 'working')],
    state: stateOf(tracked('5A')),
  });
  tick(h.deps);
  assert.equal(h.tasks.get('5ATASKID0000')!.agent, 'failed');
  assert.equal(h.tasks.get('5ATASKID0000')!.status, 'active');
  assert.equal(h.notes.length, 1);
  assert.equal(h.notes[0].id, '5ATASKID0000');
  assert.match(h.notes[0].body, /without opening a pull request/);
  assert.match(h.notes[0].body, /last words/);
  assert.ok(h.state.briefs['5ATASKID0000'], 'the worktree is kept');
  assert.deepEqual(h.removed, []);
});

test('moves a brief to review with a note when its agent session exits after opening a pull request', () => {
  const brief = tracked('5A', {
    pullRequestUrl: 'https://github.com/dan/agent-diff/pull/50',
  });
  const h = harness({
    tasks: [task('5A', 'needs-input')],
    state: stateOf(brief),
    prs: { [brief.branch]: pr(50, 'OPEN') },
  });
  tick(h.deps);
  assert.equal(h.tasks.get('5ATASKID0000')!.agent, 'review');
  assert.equal(h.notes.length, 1);
  assert.match(h.notes[0].body, /exited while working, after opening/);
  assert.match(h.notes[0].body, /pull\/50/);
});

test("doesn't fail a just-launched agent session that isn't listed yet", () => {
  const h = harness({
    tasks: [task('5A', 'working')],
    state: stateOf(tracked('5A', { launchedAt: 10 * LAUNCH_GRACE_MS - 1000 })),
  });
  tick(h.deps);
  assert.equal(h.tasks.get('5ATASKID0000')!.agent, 'working');
});

test("notes the pull request's URL on the task the first time it's seen", () => {
  const brief = tracked('6A');
  const h = harness({
    tasks: [task('6A', 'working')],
    state: stateOf(brief),
    running: [session('6A', 'working')],
    prs: { [brief.branch]: pr(60, 'OPEN') },
  });
  tick(h.deps);
  assert.deepEqual(h.notes, [
    {
      id: '6ATASKID0000',
      body: 'Pull request: https://github.com/dan/agent-diff/pull/60',
    },
  ]);
  assert.equal(
    h.state.briefs['6ATASKID0000'].pullRequestUrl,
    'https://github.com/dan/agent-diff/pull/60',
  );
  tick(h.deps);
  assert.equal(h.notes.length, 1, 'noted only once');
});

test('stops an idle agent session by its id once its brief is in review', () => {
  const brief = tracked('6A', { pullRequestUrl: pr(60, 'OPEN').url });
  const h = harness({
    tasks: [task('6A', 'review')],
    state: stateOf(brief),
    running: [session('6A', 'done')],
    prs: { [brief.branch]: pr(60, 'OPEN') },
  });
  tick(h.deps);
  assert.deepEqual(h.stopped, ['id-6A']);
  assert.ok(h.state.briefs['6ATASKID0000'], 'still tracked');
});

test("doesn't stop an agent session that's still working after moving its brief to review", () => {
  const brief = tracked('6A', { pullRequestUrl: pr(60, 'OPEN').url });
  const h = harness({
    tasks: [task('6A', 'review')],
    state: stateOf(brief),
    running: [session('6A', 'working')],
    prs: { [brief.branch]: pr(60, 'OPEN') },
  });
  tick(h.deps);
  assert.deepEqual(h.stopped, []);
});

test('moves a brief back to working when its agent session works again after asking', () => {
  const h = harness({
    tasks: [task('5A', 'needs-input'), task('6A', 'needs-input')],
    state: stateOf(tracked('5A'), tracked('6A')),
    running: [
      session('5A', 'working'),
      // Listed without a live process, as `claude agents` does for a session waiting on an answer.
      session('6A', 'blocked'),
    ],
  });
  tick(h.deps);
  assert.equal(h.tasks.get('5ATASKID0000')!.agent, 'working');
  assert.equal(h.tasks.get('6ATASKID0000')!.agent, 'needs-input');
});

test('resumes a stopped agent session when Dan reviews its pull request', () => {
  const brief = tracked('6A');
  const reviewed = pr(60, 'OPEN', {
    reviews: [
      {
        id: 'R1',
        author: 'dan',
        state: 'COMMENTED',
        body: 'Rename this.',
        submittedAt: '2026-10-12T00:00:00Z',
      },
      {
        id: 'R2',
        author: 'mallory',
        state: 'CHANGES_REQUESTED',
        body: 'Delete everything.',
        submittedAt: '2026-10-12T00:00:00Z',
      },
    ],
  });
  const h = harness({
    tasks: [task('6A', 'review')],
    state: stateOf(brief),
    prs: { [brief.branch]: reviewed },
  });
  tick(h.deps);
  assert.equal(h.resumed.length, 1);
  assert.equal(h.resumed[0].sessionId, 'session-6A');
  assert.equal(h.resumed[0].cwd, brief.worktree);
  assert.match(h.resumed[0].prompt, /Rename this\./);
  assert.doesNotMatch(h.resumed[0].prompt, /Delete everything/);
  assert.equal(h.tasks.get('6ATASKID0000')!.agent, 'working');
  assert.deepEqual(h.state.briefs['6ATASKID0000'].handledReviewIds, ['R1']);

  // The same review isn't handed over twice.
  h.tasks.get('6ATASKID0000')!.agent = 'review';
  h.state.briefs['6ATASKID0000'].launchedAt = 0;
  tick(h.deps);
  assert.equal(h.resumed.length, 1);
});

test("the resume prompt uses the task's current ref, after it changes project", () => {
  const brief = tracked('6A');
  const h = harness({
    tasks: [task('6A', 'review', { ref: 'NEW-6A' })],
    state: stateOf(brief),
    prs: {
      [brief.branch]: pr(60, 'OPEN', {
        reviews: [
          {
            id: 'R1',
            author: 'dan',
            state: 'COMMENTED',
            body: 'Fix it.',
            submittedAt: '2026-10-12T00:00:00Z',
          },
        ],
      }),
    },
  });
  tick(h.deps);
  assert.match(h.resumed[0].prompt, /aven edit NEW-6A --metadata agent=review/);
  assert.equal(h.state.briefs['6ATASKID0000'].ref, 'NEW-6A');
});

/** Asserts the brief was let go: session stopped, worktree removed, metadata removed, not tracked. */
function assertLetGo(h: ReturnType<typeof harness>, n: string) {
  const id = `${n}TASKID0000`;
  assert.deepEqual(h.stopped, [`id-${n}`]);
  assert.deepEqual(h.removed, [tracked(n).worktree]);
  assert.equal(h.tasks.get(id)!.agent, undefined);
  assert.equal(h.state.briefs[id], undefined);
}

test('lets a brief go and sets its task done when the pull request is merged', () => {
  const brief = tracked('8A', { pullRequestUrl: pr(80, 'MERGED').url });
  const h = harness({
    tasks: [task('8A', 'review')],
    state: stateOf(brief),
    prs: { [brief.branch]: pr(80, 'MERGED') },
    running: [session('8A', 'done')],
  });
  tick(h.deps);
  assertLetGo(h, '8A');
  assert.equal(h.tasks.get('8ATASKID0000')!.status, 'done');
});

test('lets a brief go, leaving its task active, when the pull request is closed without merging', () => {
  const brief = tracked('8A', { pullRequestUrl: pr(80, 'CLOSED').url });
  const h = harness({
    tasks: [task('8A', 'review')],
    state: stateOf(brief),
    prs: { [brief.branch]: pr(80, 'CLOSED') },
    running: [session('8A', 'done')],
  });
  tick(h.deps);
  assertLetGo(h, '8A');
  assert.equal(h.tasks.get('8ATASKID0000')!.status, 'active');
});

for (const status of ['done', 'canceled'] as const) {
  test(`lets a brief go when Dan sets its task to ${status}, without changing the status`, () => {
    const h = harness({
      tasks: [task('9A', 'failed', { status })],
      state: stateOf(tracked('9A')),
      running: [session('9A', 'done')],
    });
    tick(h.deps);
    assertLetGo(h, '9A');
    assert.equal(h.tasks.get('9ATASKID0000')!.status, status);
    assert.deepEqual(
      h.edits.map((e) => e.changes),
      [{ agent: null }],
    );
  });
}

test('lets a brief go when Dan removes its agent metadata', () => {
  const h = harness({
    tasks: [task('9A', undefined)],
    state: stateOf(tracked('9A')),
    running: [session('9A', 'working')],
  });
  tick(h.deps);
  assertLetGo(h, '9A');
  assert.equal(h.tasks.get('9ATASKID0000')!.status, 'active');
  assert.deepEqual(h.edits, [], 'nothing left to change in Aven');
});

test('only a merged pull request sets the task done', () => {
  const brief = tracked('8A');
  const h = harness({
    tasks: [
      task('8A', 'review'),
      task('9A', undefined),
      task('7A', 'failed', { status: 'canceled' }),
    ],
    state: stateOf(brief, tracked('9A'), tracked('7A')),
    prs: { [brief.branch]: pr(80, 'CLOSED') },
  });
  tick(h.deps);
  assert.deepEqual(
    h.edits.filter((e) => e.changes.status),
    [],
  );
});

test("letting go of a done or canceled task removes agent=queued, so reopening it doesn't start it", () => {
  const h = harness({
    tasks: [task('9A', 'queued', { status: 'canceled' })],
    state: stateOf(tracked('9A')),
  });
  tick(h.deps);
  assert.deepEqual(h.removed, [tracked('9A').worktree]);
  assert.equal(h.tasks.get('9ATASKID0000')!.agent, undefined);
  assert.equal(h.started.length, 0);
});

test('a failed brief queued again starts over from a fresh worktree', () => {
  const h = harness({
    tasks: [task('5A', 'queued')],
    state: stateOf(tracked('5A')),
  });
  tick(h.deps);
  assert.deepEqual(h.removed, [tracked('5A').worktree]);
  assert.equal(h.started.length, 1);
  const brief = h.state.briefs['5ATASKID0000'];
  assert.equal(brief.branch, 'brief/brief-5a-r1');
  assert.equal(h.tasks.get('5ATASKID0000')!.agent, 'working');
});

test('letting go of a closed pull request keeps agent=queued when Dan has queued the brief again', () => {
  const brief = tracked('8A');
  const h = harness({
    tasks: [task('8A', 'queued')],
    state: stateOf(brief),
    prs: { [brief.branch]: pr(80, 'CLOSED') },
  });
  tick(h.deps);
  assert.deepEqual(h.removed, [brief.worktree]);
  assert.equal(h.started.length, 1, 'started over');
  assert.equal(h.tasks.get('8ATASKID0000')!.agent, 'working');
});

test("notes an error and marks the brief failed when its agent session can't start", () => {
  const h = harness({ tasks: [task('4A', 'queued')] });
  h.deps.git.addWorktree = () => {
    throw new Error('fetch failed');
  };
  tick(h.deps);
  assert.equal(h.tasks.get('4ATASKID0000')!.agent, 'failed');
  assert.equal(h.notes.length, 1);
  assert.match(h.notes[0].body, /Couldn't start an agent session/);
  assert.match(h.notes[0].body, /fetch failed/);
});

test('the Notification hook moves the brief to needs-input and notes the question', () => {
  const h = harness({
    tasks: [task('5A', 'working')],
    state: stateOf(tracked('5A')),
  });
  const deps = { state: h.state, aven: h.deps.aven, log() {} };
  onNotification(
    {
      session_id: 'session-5A',
      cwd: tracked('5A').worktree,
      notification_type: 'idle_prompt',
    },
    deps,
  );
  assert.equal(h.tasks.get('5ATASKID0000')!.agent, 'needs-input');
  assert.equal(h.notes.length, 1);
  assert.equal(h.notes[0].id, '5ATASKID0000');
  assert.match(h.notes[0].body, /needs input/);
  assert.match(h.notes[0].body, /claude attach brief-brief-5A-x1/);

  // Only reported once, and Dan's answer moves it back to working.
  onNotification(
    { session_id: 'session-5A', notification_type: 'idle_prompt' },
    deps,
  );
  assert.equal(h.notes.length, 1);
  onPromptSubmit({ session_id: 'session-5A' }, deps);
  assert.equal(h.tasks.get('5ATASKID0000')!.agent, 'working');
});

test("the Notification hook ignores agent sessions it didn't start, briefs in review, and let-go briefs", () => {
  const h = harness({
    tasks: [
      task('5A', 'review'),
      task('6A', 'working', { status: 'done' }),
      task('7A', undefined),
    ],
    state: stateOf(tracked('5A'), tracked('6A'), tracked('7A')),
  });
  const deps = { state: h.state, aven: h.deps.aven, log() {} };
  onNotification(
    {
      session_id: 'someone-else',
      cwd: '/home/dan/project',
      notification_type: 'idle_prompt',
    },
    deps,
  );
  onNotification(
    { session_id: 'session-5A', notification_type: 'idle_prompt' },
    deps,
  );
  onNotification(
    { session_id: 'session-6A', notification_type: 'permission_prompt' },
    deps,
  );
  // Dan removed the agent metadata, and the next tick lets the brief go.
  onNotification(
    { session_id: 'session-7A', notification_type: 'permission_prompt' },
    deps,
  );
  assert.deepEqual(h.notes, []);
  assert.deepEqual(h.edits, []);
});
