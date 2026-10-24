import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Aven, Blocker, Note, Task, TaskChanges } from '../src/aven.ts';
import type { AgentSessionInfo, Claude, StartOptions } from '../src/claude.ts';
import type { Config } from '../src/config.ts';
import type { GitHub, PullRequest } from '../src/github.ts';
import { onNotification, onPromptSubmit } from '../src/hook.ts';
import type { BriefState, State } from '../src/state.ts';
import {
  LAUNCH_GRACE_MS,
  tick,
  waitingBriefs,
  type Deps,
} from '../src/tick.ts';

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
    blockers: [],
    notes: [],
    ...extra,
  };
}

/** A note already on a task, before the tick. */
function note(id: string, body: string): Note {
  return { id, body, createdAt: '2026-10-24T00:00:00Z' };
}

/** `task(n)` as a blocker of another task, as `aven show` lists it. */
function blocker(n: string, status: Task['status'], deleted = false): Blocker {
  const { id, ref, title } = task(n, undefined);
  return { id, ref, title, status, deleted };
}

function harness(
  options: {
    tasks?: Task[];
    prs?: Record<string, PullRequest>;
    running?: AgentSessionInfo[];
    state?: State;
    now?: number;
    concurrency?: number;
  } = {},
) {
  const tasks = new Map((options.tasks ?? []).map((t) => [t.id, t]));
  const prs = options.prs ?? {};
  const running = options.running ?? [];
  /** The notes the tick added, each with the ID of its task. Their own IDs are `added-1`, `added-2`, and so on. */
  const notes: { id: string; body: string }[] = [];
  const edits: { id: string; changes: TaskChanges }[] = [];
  const started: StartOptions[] = [];
  const resumed: { cwd: string; sessionId: string; prompt: string }[] = [];
  const stopped: string[] = [];
  const removed: string[] = [];
  const added: { dir: string; branch: string }[] = [];
  const logs: string[] = [];
  const state: State = options.state ?? { briefs: {} };
  // Like `aven show`, reads each blocker's current status when it's one of the fake's tasks.
  const read = (t: Task): Task =>
    structuredClone({
      ...t,
      blockers: t.blockers.map((b) => {
        const current = tasks.get(b.id);
        return current ? { ...b, status: current.status } : b;
      }),
    });
  // Mirrors `aven list --project agent-diff --open --metadata agent=<agent>`.
  const listed = (agent: string) =>
    [...tasks.values()].filter(
      (t) =>
        t.agent === agent && t.status !== 'done' && t.status !== 'canceled',
    );
  const aven: Aven = {
    queuedTasks: () => listed('queued').map(read),
    retryTasks: () => listed('retry').map((t) => ({ id: t.id, ref: t.ref })),
    task: (id) => read(tasks.get(id)!),
    edit(id, changes) {
      edits.push({ id, changes });
      const t = tasks.get(id)!;
      if (changes.status) t.status = changes.status;
      if (changes.agent === null) t.agent = undefined;
      else if (changes.agent) t.agent = changes.agent;
    },
    note(id, body) {
      notes.push({ id, body });
      const noteId = `added-${notes.length}`;
      tasks.get(id)?.notes.push(note(noteId, body));
      return noteId;
    },
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
    config: {
      ...config,
      concurrency: options.concurrency ?? config.concurrency,
    },
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
    log: (message) => logs.push(message),
  };
  return {
    deps,
    logs,
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
  assert.deepEqual(h.notes, [{ id: '5ATASKID0000', body: failureNote('5A') }]);
  assert.ok(h.state.briefs['5ATASKID0000'], 'the worktree is kept');
  assert.equal(
    h.state.briefs['5ATASKID0000'].failureNoteId,
    'added-1',
    "the failure note's ID is recorded",
  );
  assert.deepEqual(h.removed, []);
});

/** The note `reap` adds when brief `n`'s agent session exits without a pull request. */
function failureNote(n: string): string {
  return `The agent session exited without opening a pull request. Its worktree \`${tracked(n).worktree}\` and conversation are kept.

- To resume the agent session where it stopped, add a note with anything it should know, then set \`agent=retry\`.
- To start over from a fresh worktree, set \`agent=queued\`.

End of the agent session's output:

\`\`\`\`
last words
\`\`\`\``;
}

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

test("doesn't start a queued brief until its blockers are done, and logs what it's waiting on", () => {
  const h = harness({
    tasks: [
      task('1B', undefined, { status: 'todo' }),
      task('2B', 'queued', {
        status: 'todo',
        blockers: [
          blocker('1B', 'todo'),
          blocker('9X', 'done'),
          blocker('8X', 'active'),
        ],
      }),
    ],
  });
  tick(h.deps);
  assert.equal(h.started.length, 0);
  assert.deepEqual(h.edits, []);
  assert.deepEqual(h.notes, []);
  assert.equal(h.tasks.get('2BTASKID0000')!.agent, 'queued');
  assert.equal(h.state.briefs['2BTASKID0000'], undefined);
  assert.ok(
    h.logs.includes('AD-2B: waiting on AD-1B, AD-8X'),
    h.logs.join('\n'),
  );
});

test("briefs waiting on blockers don't use a concurrency slot or hold up the briefs after them", () => {
  const h = harness({
    tasks: [
      task('1B', 'queued', { blockers: [blocker('9X', 'todo')] }),
      task('2B', 'queued', { blockers: [blocker('9X', 'inbox')] }),
      task('3B', 'queued'),
      task('4B', 'queued'),
    ],
  });
  tick(h.deps);
  assert.deepEqual(
    h.started.map((s) => s.name),
    ['brief-brief-3b-r1', 'brief-brief-4b-r2'],
  );
});

test('logs every brief waiting on blockers, even after the concurrency slots are used up', () => {
  const h = harness({
    tasks: [
      task('1B', 'queued'),
      task('2B', 'queued'),
      task('3B', 'queued'),
      task('4B', 'queued', { blockers: [blocker('9X', 'todo')] }),
    ],
  });
  tick(h.deps);
  assert.equal(h.started.length, 2);
  assert.ok(h.logs.includes('AD-4B: waiting on AD-9X'), h.logs.join('\n'));
  assert.equal(h.tasks.get('3BTASKID0000')!.agent, 'queued');
});

test('starts a queued brief whose blockers are all done', () => {
  const h = harness({
    tasks: [
      task('2B', 'queued', {
        blockers: [blocker('1B', 'done'), blocker('9X', 'done')],
      }),
    ],
  });
  tick(h.deps);
  assert.equal(h.started.length, 1);
  assert.equal(h.tasks.get('2BTASKID0000')!.agent, 'working');
});

test('starts a brief in the same tick that sets its blocker done, after its pull request merges', () => {
  const brief = tracked('1B', { pullRequestUrl: pr(10, 'MERGED').url });
  const h = harness({
    tasks: [
      task('1B', 'review'),
      task('2B', 'queued', { blockers: [blocker('1B', 'active')] }),
    ],
    state: stateOf(brief),
    prs: { [brief.branch]: pr(10, 'MERGED') },
  });
  tick(h.deps);
  assert.equal(h.tasks.get('1BTASKID0000')!.status, 'done');
  assert.deepEqual(
    h.started.map((s) => s.name),
    ['brief-brief-2b-r1'],
  );
});

test('sends back a queued brief with a canceled or deleted blocker, with a note naming each', () => {
  const h = harness({
    tasks: [
      task('2B', 'queued', {
        status: 'todo',
        blockers: [
          blocker('1B', 'canceled'),
          blocker('9X', 'done', true),
          blocker('8X', 'todo', true),
          blocker('7X', 'done'),
          blocker('6X', 'todo'),
        ],
      }),
      task('3B', 'queued'),
      task('4B', 'queued'),
    ],
  });
  tick(h.deps);
  const t = h.tasks.get('2BTASKID0000')!;
  assert.equal(t.agent, undefined);
  assert.equal(t.status, 'todo');
  assert.equal(h.notes.length, 1);
  const note = h.notes[0];
  assert.equal(note.id, '2BTASKID0000');
  for (const ref of ['AD-1B', 'AD-9X', 'AD-8X'])
    assert.match(note.body, new RegExp(`\`aven dep remove AD-2B ${ref}\``));
  assert.doesNotMatch(note.body, /AD-7X|AD-6X/);
  assert.match(note.body, /AD-1B Brief 1B \(canceled\)/);
  assert.match(note.body, /AD-9X Brief 9X \(deleted\)/);
  assert.match(note.body, /`agent=queued` again/);
  // Sending it back doesn't use a concurrency slot.
  assert.deepEqual(
    h.started.map((s) => s.name),
    ['brief-brief-3b-r1', 'brief-brief-4b-r2'],
  );
});

test('a brief missing required fields is sent back for that, even with a canceled blocker', () => {
  const h = harness({
    tasks: [
      task('2B', 'queued', {
        description: '### Goal\n\nDo it.',
        blockers: [blocker('1B', 'canceled')],
      }),
    ],
  });
  tick(h.deps);
  assert.equal(h.notes.length, 1);
  assert.match(h.notes[0].body, /missing required fields/);
  assert.doesNotMatch(h.notes[0].body, /aven dep remove/);
});

test('lists the queued briefs waiting on blockers, with their open blockers', () => {
  const waiting = task('2B', 'queued', {
    blockers: [blocker('1B', 'todo'), blocker('9X', 'done')],
  });
  const result = waitingBriefs([
    task('3B', 'queued'),
    waiting,
    task('4B', 'queued', { blockers: [blocker('9X', 'done')] }),
    // These are sent back on the next tick instead.
    task('5B', 'queued', {
      blockers: [blocker('1B', 'todo'), blocker('8X', 'canceled')],
    }),
    task('6B', 'queued', {
      description: '### Goal',
      blockers: [blocker('1B', 'todo')],
    }),
  ]);
  assert.deepEqual(result, [
    { task: waiting, blockers: [blocker('1B', 'todo')] },
  ]);
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

test("records the failure note's ID when the agent session can't start after its worktree is created", () => {
  const h = harness({ tasks: [task('4A', 'queued')] });
  h.deps.claude.start = () => {
    throw new Error('claude failed');
  };
  tick(h.deps);
  assert.equal(h.tasks.get('4ATASKID0000')!.agent, 'failed');
  assert.match(h.notes[0].body, /claude failed/);
  assert.equal(h.state.briefs['4ATASKID0000'].failureNoteId, 'added-1');
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

/** Brief `n`, tracked after failing, with its failure note between an earlier note and Dan's notes. */
function failed(n: string, danNotes: string[], extra: Partial<Task> = {}) {
  const brief = tracked(n, { failureNoteId: `failure-${n}` });
  const t = task(n, 'retry', {
    notes: [
      note(`before-${n}`, 'An earlier note.'),
      note(`failure-${n}`, failureNote(n)),
      ...danNotes.map((body, i) => note(`dan-${n}-${i}`, body)),
    ],
    ...extra,
  });
  return { brief, task: t };
}

test('retries a failed brief by resuming its agent session with the notes added since it failed', () => {
  const { brief, task: t } = failed('5A', ['Use the parser.', 'Skip step 3.']);
  const h = harness({ tasks: [t], state: stateOf(brief) });
  tick(h.deps);
  assert.equal(h.resumed.length, 1);
  assert.equal(h.resumed[0].sessionId, 'session-5A');
  assert.equal(h.resumed[0].cwd, brief.worktree);
  const prompt = h.resumed[0].prompt;
  assert.match(prompt, /Use the parser\./);
  assert.match(prompt, /Skip step 3\./);
  assert.doesNotMatch(prompt, /An earlier note/);
  assert.doesNotMatch(prompt, /End of the agent session's output/);
  assert.equal(h.tasks.get('5ATASKID0000')!.agent, 'working');
  assert.equal(h.state.briefs['5ATASKID0000'].launchedAt, 10 * LAUNCH_GRACE_MS);
  assert.deepEqual(h.notes, [
    {
      id: '5ATASKID0000',
      body: 'Retried: resumed the agent session `brief-brief-5A-x1` where it stopped, with 2 notes added since it failed.',
    },
  ]);
  assert.deepEqual(h.started, []);
  assert.ok(
    h.logs.includes('AD-5A: retried brief-brief-5A-x1 with 2 note(s)'),
    h.logs.join('\n'),
  );
});

test('the retried note counts one note, or says none were added', () => {
  const one = failed('5A', ['Use the parser.']);
  const none = failed('6A', []);
  const h = harness({
    tasks: [one.task, none.task],
    state: stateOf(one.brief, none.brief),
  });
  tick(h.deps);
  assert.deepEqual(
    h.notes.map((n) => n.body),
    [
      'Retried: resumed the agent session `brief-brief-5A-x1` where it stopped, with 1 note added since it failed.',
      'Retried: resumed the agent session `brief-brief-6A-x1` where it stopped, with no notes added since it failed.',
    ],
  );
  assert.match(
    h.resumed[1].prompt,
    /No notes were added to the brief since it failed\./,
  );
});

test('a retry uses a concurrency slot, before queued briefs start', () => {
  const { brief, task: t } = failed('5A', []);
  const h = harness({
    tasks: [task('1A', 'working'), t, task('2A', 'queued')],
    state: stateOf(tracked('1A'), brief),
    running: [session('1A', 'working')],
  });
  tick(h.deps);
  assert.equal(h.resumed.length, 1);
  assert.deepEqual(h.started, []);
  assert.equal(h.tasks.get('2ATASKID0000')!.agent, 'queued');
});

test('a retry waits in agent=retry, without failing, while no concurrency slot is free, and runs after review resumes', () => {
  const reviewed = tracked('6A');
  const { brief, task: t } = failed('5A', ['Use the parser.']);
  const h = harness({
    concurrency: 1,
    tasks: [task('6A', 'review'), t],
    state: stateOf(reviewed, brief),
    prs: {
      [reviewed.branch]: pr(60, 'OPEN', {
        reviews: [
          {
            id: 'R1',
            author: 'dan',
            state: 'COMMENTED',
            body: 'Rename this.',
            submittedAt: '2026-10-12T00:00:00Z',
          },
        ],
      }),
    },
  });
  tick(h.deps);
  assert.deepEqual(
    h.resumed.map((r) => r.sessionId),
    ['session-6A'],
  );
  assert.equal(h.tasks.get('5ATASKID0000')!.agent, 'retry');
  assert.deepEqual(
    h.notes.filter((n) => n.id === '5ATASKID0000'),
    [],
  );
  assert.ok(
    h.logs.includes('AD-5A: retry waiting for a free concurrency slot'),
    h.logs.join('\n'),
  );

  // Once the slot is free, it's retried.
  h.running.push(session('6A', 'done'));
  h.tasks.get('6ATASKID0000')!.agent = 'review';
  tick(h.deps);
  assert.equal(h.resumed.length, 2);
  assert.equal(h.resumed[1].sessionId, 'session-5A');
});

test('a retry waits while its agent session is still running', () => {
  const { brief, task: t } = failed('5A', []);
  const h = harness({
    tasks: [t],
    state: stateOf(brief),
    running: [session('5A', 'working')],
  });
  tick(h.deps);
  assert.deepEqual(h.resumed, []);
  assert.deepEqual(h.notes, []);
  assert.deepEqual(h.edits, []);
  assert.ok(
    h.logs.includes(
      'AD-5A: retry set while its agent session is running; waiting for it to exit',
    ),
    h.logs.join('\n'),
  );
});

test('a retry waits while its agent session was just launched and may not be listed yet', () => {
  const { brief, task: t } = failed('5A', []);
  brief.launchedAt = 10 * LAUNCH_GRACE_MS - 1000;
  const h = harness({ tasks: [t], state: stateOf(brief) });
  tick(h.deps);
  assert.deepEqual(h.resumed, []);
  assert.equal(h.tasks.get('5ATASKID0000')!.agent, 'retry');
});

test("a brief without a session ID can't be retried, and goes back to failed with a note", () => {
  const { brief, task: t } = failed('5A', []);
  delete brief.sessionId;
  const h = harness({ tasks: [t], state: stateOf(brief) });
  tick(h.deps);
  assert.deepEqual(h.resumed, []);
  assert.equal(h.tasks.get('5ATASKID0000')!.agent, 'failed');
  assert.deepEqual(h.notes, [
    {
      id: '5ATASKID0000',
      body: `Couldn't retry this brief: \`implement\` has no session ID for its agent session, so it can't resume it. The worktree \`${brief.worktree}\` is kept. Set \`agent=queued\` to start over.`,
    },
  ]);
  assert.equal(h.state.briefs['5ATASKID0000'].failureNoteId, 'added-1');
});

test('a brief whose resume command fails goes back to failed with the error, and its slot goes to a queued brief', () => {
  const { brief, task: t } = failed('5A', []);
  const h = harness({
    concurrency: 1,
    tasks: [t, task('2A', 'queued')],
    state: stateOf(brief),
  });
  h.deps.claude.resume = () => {
    throw new Error('No conversation found');
  };
  tick(h.deps);
  assert.equal(h.tasks.get('5ATASKID0000')!.agent, 'failed');
  assert.deepEqual(h.notes, [
    {
      id: '5ATASKID0000',
      body: `Couldn't retry this brief: resuming its agent session failed:\n\n\`\`\`\nNo conversation found\n\`\`\`\n\nThe worktree \`${brief.worktree}\` is kept. Set \`agent=retry\` to try again, or \`agent=queued\` to start over.`,
    },
  ]);
  assert.equal(h.state.briefs['5ATASKID0000'].failureNoteId, 'added-1');
  assert.ok(h.state.briefs['5ATASKID0000'], 'the worktree is kept');
  assert.deepEqual(h.removed, []);
  assert.deepEqual(
    h.started.map((s) => s.name),
    ['brief-brief-2a-r1'],
  );
});

test("removes agent=retry from a task implement isn't tracking, with a note saying there's nothing to retry", () => {
  const h = harness({
    tasks: [task('3A', 'retry', { status: 'todo' })],
  });
  tick(h.deps);
  assert.equal(h.tasks.get('3ATASKID0000')!.agent, undefined);
  assert.equal(h.tasks.get('3ATASKID0000')!.status, 'todo');
  assert.deepEqual(h.notes, [
    {
      id: '3ATASKID0000',
      body: "There's nothing to retry: `implement` has no worktree or agent session for this brief. Set `agent=queued` to start it.",
    },
  ]);
  assert.deepEqual(h.resumed, []);
  assert.deepEqual(h.started, []);
  assert.ok(
    h.logs.includes('AD-3A: retry set but not tracked, removed it'),
    h.logs.join('\n'),
  );
});

test("a tracked brief in agent=retry that couldn't be read this tick isn't treated as untracked", () => {
  const { brief, task: t } = failed('5A', []);
  const h = harness({ tasks: [t], state: stateOf(brief) });
  const read = h.deps.aven.task;
  h.deps.aven.task = (id) => {
    if (id === t.id) throw new Error('aven failed');
    return read(id);
  };
  tick(h.deps);
  assert.deepEqual(h.notes, []);
  assert.deepEqual(h.edits, []);
  assert.deepEqual(h.resumed, []);
});

test('a retried brief that exits again without a pull request is marked failed again, and can be retried again', () => {
  const { brief, task: t } = failed('5A', ['Use the parser.']);
  const h = harness({ tasks: [t], state: stateOf(brief) });
  tick(h.deps);
  assert.equal(h.tasks.get('5ATASKID0000')!.agent, 'working');

  // It exits again, after the grace period.
  h.state.briefs['5ATASKID0000'].launchedAt = 0;
  tick(h.deps);
  assert.equal(h.tasks.get('5ATASKID0000')!.agent, 'failed');
  assert.equal(h.notes.at(-1)!.body, failureNote('5A'));
  const failureId = h.state.briefs['5ATASKID0000'].failureNoteId;
  assert.equal(failureId, 'added-2');

  // Dan adds a note and retries it again: only the notes after the new failure note are passed.
  const current = h.tasks.get('5ATASKID0000')!;
  current.notes.push(note('dan-again', 'Now try the other way.'));
  current.agent = 'retry';
  tick(h.deps);
  assert.equal(h.resumed.length, 2);
  assert.match(h.resumed[1].prompt, /Now try the other way\./);
  assert.doesNotMatch(h.resumed[1].prompt, /Use the parser\./);
  assert.doesNotMatch(h.resumed[1].prompt, /Retried:/);
  assert.equal(
    h.notes.at(-1)!.body,
    'Retried: resumed the agent session `brief-brief-5A-x1` where it stopped, with 1 note added since it failed.',
  );
});

test('reap leaves a brief in agent=retry alone when its agent session is gone, as it does a failed one', () => {
  const { brief, task: t } = failed('5A', []);
  const h = harness({
    concurrency: 1,
    tasks: [task('1A', 'working'), t],
    state: stateOf(tracked('1A'), brief),
    running: [session('1A', 'working')],
  });
  tick(h.deps);
  assert.equal(h.tasks.get('5ATASKID0000')!.agent, 'retry');
  assert.deepEqual(h.notes, []);
});
