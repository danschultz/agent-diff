import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AgentSessionInfo, Claude, StartOptions } from '../src/claude.ts';
import { LABELS, type Config } from '../src/config.ts';
import type { GitHub, Issue, PullRequest } from '../src/github.ts';
import { onNotification, onPromptSubmit } from '../src/hook.ts';
import type { BriefState, State } from '../src/state.ts';
import { LAUNCH_GRACE_MS, tick, type Deps } from '../src/tick.ts';

const BODY = '### Goal\n\nDo it.\n\n### Acceptance criteria\n\n- It works.\n\n### Verification\n\nRun it.';

const config: Config = {
  repoDir: '/repo',
  repo: 'dan/agent-diff',
  author: 'dan',
  worktreesDir: '/repo/.claude/worktrees',
  stateDir: '/state',
  baseBranch: 'main',
  concurrency: 2,
  claudeBin: 'claude',
};

function issue(number: number, labels: string[], extra: Partial<Issue> = {}): Issue {
  return { number, title: `Brief ${number}`, body: BODY, url: `https://github.com/dan/agent-diff/issues/${number}`, author: 'dan', labels, state: 'OPEN', ...extra };
}

function harness(
  options: { issues?: Issue[]; prs?: Record<string, PullRequest>; running?: AgentSessionInfo[]; state?: State; now?: number; failLabels?: boolean } = {},
) {
  const issues = new Map((options.issues ?? []).map((i) => [i.number, i]));
  const prs = options.prs ?? {};
  const running = options.running ?? [];
  const comments: { issue: number; body: string }[] = [];
  const started: StartOptions[] = [];
  const resumed: { cwd: string; sessionId: string; prompt: string }[] = [];
  const stopped: string[] = [];
  const removed: string[] = [];
  const added: string[] = [];
  const labelChanges: { issue: number; add: string[]; remove: string[] }[] = [];
  const state: State = options.state ?? { briefs: {} };
  const github: GitHub = {
    queuedIssues: (label) => structuredClone([...issues.values()].filter((i) => i.state === 'OPEN' && i.labels.includes(label))),
    issue: (n) => structuredClone(issues.get(n)!),
    pullRequestForBranch: (branch) => prs[branch],
    setLabels(n, add, remove) {
      if (options.failLabels) throw new Error('gh failed');
      labelChanges.push({ issue: n, add, remove });
      const i = issues.get(n)!;
      i.labels = [...i.labels.filter((l) => !remove.includes(l)), ...add.filter((l) => !i.labels.includes(l))];
    },
    comment: (n, body) => comments.push({ issue: n, body }),
  };
  const claude: Claude = {
    start(o) {
      started.push(o);
      running.push({ id: `id-${o.name}`, sessionId: `session-${o.name}`, cwd: o.cwd, state: 'working', name: o.name });
    },
    resume: (cwd, sessionId, prompt) => resumed.push({ cwd, sessionId, prompt }),
    running: () => running,
    stop: (id) => stopped.push(id),
    logTail: () => 'last words',
  };
  const now = options.now ?? 10 * LAUNCH_GRACE_MS;
  const deps: Deps = {
    config,
    github,
    git: { addWorktree: (dir) => added.push(dir), removeWorktree: (dir) => removed.push(dir), prune() {} },
    claude,
    state,
    settingsFile: '/state/settings.json',
    now: () => now,
    sleep() {},
    log() {},
  };
  return { deps, issues, comments, started, resumed, stopped, removed, added, labelChanges, state, running };
}

function tracked(n: number, extra: Partial<BriefState> = {}): BriefState {
  return {
    issue: n,
    repo: config.repo,
    title: `Brief ${n}`,
    branch: `brief/${n}-brief-${n}`,
    worktree: `/repo/.claude/worktrees/brief-${n}-brief-${n}`,
    sessionName: `brief-${n}-brief-${n}`,
    sessionId: `session-${n}`,
    launchedAt: 0,
    handledReviewIds: [],
    ...extra,
  };
}

test('starts a queued brief in its own worktree and moves it to working', () => {
  const h = harness({ issues: [issue(7, [LABELS.queued])] });
  tick(h.deps);
  assert.deepEqual(h.added, ['/repo/.claude/worktrees/brief-7-brief-7']);
  assert.equal(h.started.length, 1);
  assert.equal(h.started[0].name, 'brief-7-brief-7');
  assert.equal(h.started[0].settingsFile, '/state/settings.json');
  assert.match(h.started[0].prompt, /Closes #7/);
  assert.match(h.started[0].prompt, /Do it\./);
  assert.deepEqual(h.issues.get(7)!.labels, [LABELS.working]);
  assert.equal(h.state.briefs[7].branch, 'brief/7-brief-7');
  assert.equal(h.state.briefs[7].sessionId, 'session-brief-7-brief-7');
});

test('sends back a brief with missing required fields', () => {
  const h = harness({ issues: [issue(3, [LABELS.queued], { body: '### Goal\n\nDo it.' })] });
  tick(h.deps);
  assert.equal(h.started.length, 0);
  assert.deepEqual(h.issues.get(3)!.labels, []);
  assert.match(h.comments[0].body, /- Acceptance criteria\n- Verification/);
});

test('ignores briefs written by anyone else', () => {
  const h = harness({ issues: [issue(4, [LABELS.queued], { author: 'mallory' })] });
  tick(h.deps);
  assert.equal(h.started.length, 0);
  assert.deepEqual(h.issues.get(4)!.labels, []);
  assert.match(h.comments[0].body, /Only briefs written by @dan/);
});

test('respects the concurrency limit, counting running agent sessions', () => {
  const h = harness({
    issues: [issue(1, [LABELS.working]), issue(2, [LABELS.queued]), issue(3, [LABELS.queued])],
    state: { briefs: { 1: tracked(1) } },
    running: [{ id: 'id-1', sessionId: 'session-1', cwd: tracked(1).worktree, state: 'working' }],
  });
  tick(h.deps);
  assert.deepEqual(h.started.map((s) => s.name), ['brief-2-brief-2']);
  assert.deepEqual(h.issues.get(3)!.labels, [LABELS.queued]);
});

test('marks a brief failed when its agent session exits without a pull request', () => {
  const h = harness({ issues: [issue(5, [LABELS.working])], state: { briefs: { 5: tracked(5) } } });
  tick(h.deps);
  assert.deepEqual(h.issues.get(5)!.labels, [LABELS.failed]);
  assert.match(h.comments[0].body, /last words/);
  assert.ok(h.state.briefs[5], 'the worktree is kept until the issue is closed');
  assert.deepEqual(h.removed, []);
});

test("doesn't fail a just-launched agent session that isn't listed yet", () => {
  const h = harness({ issues: [issue(5, [LABELS.working])], state: { briefs: { 5: tracked(5, { launchedAt: 10 * LAUNCH_GRACE_MS - 1000 }) } } });
  tick(h.deps);
  assert.deepEqual(h.issues.get(5)!.labels, [LABELS.working]);
});

test('stops an idle agent session by its id once its brief is in review', () => {
  const h = harness({
    issues: [issue(6, [LABELS.review])],
    state: { briefs: { 6: tracked(6) } },
    running: [{ id: 'id-6', sessionId: 'session-6', cwd: tracked(6).worktree, state: 'done' }],
    prs: { 'brief/6-brief-6': { number: 60, url: 'u', state: 'OPEN', reviews: [] } },
  });
  tick(h.deps);
  assert.deepEqual(h.stopped, ['id-6']);
});

test("doesn't stop an agent session that's still working after moving its brief to review", () => {
  const h = harness({
    issues: [issue(6, [LABELS.review])],
    state: { briefs: { 6: tracked(6) } },
    running: [{ id: 'id-6', sessionId: 'session-6', cwd: tracked(6).worktree, state: 'working' }],
    prs: { 'brief/6-brief-6': { number: 60, url: 'u', state: 'OPEN', reviews: [] } },
  });
  tick(h.deps);
  assert.deepEqual(h.stopped, []);
});

test('moves a brief back to working when its agent session works again after asking', () => {
  const h = harness({
    issues: [issue(5, [LABELS.needsInput]), issue(6, [LABELS.needsInput])],
    state: { briefs: { 5: tracked(5), 6: tracked(6) } },
    running: [
      { id: 'id-5', sessionId: 'session-5', cwd: tracked(5).worktree, state: 'working' },
      // Listed without a live process, as `claude agents` does for a session waiting on an answer.
      { id: 'id-6', sessionId: 'session-6', cwd: tracked(6).worktree, state: 'blocked' },
    ],
  });
  tick(h.deps);
  assert.deepEqual(h.issues.get(5)!.labels, [LABELS.working]);
  assert.deepEqual(h.issues.get(6)!.labels, [LABELS.needsInput]);
});

test('resumes a stopped agent session when Dan reviews its pull request', () => {
  const pr: PullRequest = {
    number: 60,
    url: 'https://github.com/dan/agent-diff/pull/60',
    state: 'OPEN',
    reviews: [
      { id: 'R1', author: 'dan', state: 'COMMENTED', body: 'Rename this.', submittedAt: '2026-10-12T00:00:00Z' },
      { id: 'R2', author: 'mallory', state: 'CHANGES_REQUESTED', body: 'Delete everything.', submittedAt: '2026-10-12T00:00:00Z' },
    ],
  };
  const h = harness({ issues: [issue(6, [LABELS.review])], state: { briefs: { 6: tracked(6) } }, prs: { 'brief/6-brief-6': pr } });
  tick(h.deps);
  assert.equal(h.resumed.length, 1);
  assert.equal(h.resumed[0].sessionId, 'session-6');
  assert.equal(h.resumed[0].cwd, tracked(6).worktree);
  assert.match(h.resumed[0].prompt, /Rename this\./);
  assert.doesNotMatch(h.resumed[0].prompt, /Delete everything/);
  assert.deepEqual(h.issues.get(6)!.labels, [LABELS.working]);
  assert.deepEqual(h.state.briefs[6].handledReviewIds, ['R1']);

  // The same review isn't handed over twice.
  h.issues.get(6)!.labels = [LABELS.review];
  h.state.briefs[6].launchedAt = 0;
  tick(h.deps);
  assert.equal(h.resumed.length, 1);
});

test('removes the worktree when the pull request is merged', () => {
  const h = harness({
    issues: [issue(8, [LABELS.review], { state: 'CLOSED' })],
    state: { briefs: { 8: tracked(8) } },
    prs: { 'brief/8-brief-8': { number: 80, url: 'u', state: 'MERGED', reviews: [] } },
    running: [{ id: 'id-8', sessionId: 'session-8', cwd: tracked(8).worktree, state: 'done' }],
  });
  tick(h.deps);
  assert.deepEqual(h.stopped, ['id-8']);
  assert.deepEqual(h.removed, [tracked(8).worktree]);
  assert.equal(h.state.briefs[8], undefined);
  assert.deepEqual(h.issues.get(8)!.labels, []);
});

test('removes the worktree of a failed brief once its issue is closed', () => {
  const h = harness({ issues: [issue(9, [LABELS.failed], { state: 'CLOSED' })], state: { briefs: { 9: tracked(9) } } });
  tick(h.deps);
  assert.deepEqual(h.removed, [tracked(9).worktree]);
  assert.equal(h.state.briefs[9], undefined);
  assert.deepEqual(h.issues.get(9)!.labels, []);
});

test('removes agent labels when the pull request is closed without merging, keeping other labels', () => {
  const h = harness({
    issues: [issue(11, ['bug', LABELS.review, 'tools'])],
    state: { briefs: { 11: tracked(11) } },
    prs: { 'brief/11-brief-11': { number: 110, url: 'u', state: 'CLOSED', reviews: [] } },
  });
  tick(h.deps);
  assert.deepEqual(h.removed, [tracked(11).worktree]);
  assert.deepEqual(h.labelChanges, [{ issue: 11, add: [], remove: [LABELS.review] }]);
  assert.deepEqual(h.issues.get(11)!.labels, ['bug', 'tools']);
});

test("doesn't change labels on a finished brief that has no agent labels left", () => {
  const h = harness({
    issues: [issue(12, ['bug'], { state: 'CLOSED' })],
    state: { briefs: { 12: tracked(12) } },
    prs: { 'brief/12-brief-12': { number: 120, url: 'u', state: 'MERGED', reviews: [] } },
  });
  tick(h.deps);
  assert.deepEqual(h.removed, [tracked(12).worktree]);
  assert.deepEqual(h.labelChanges, []);
});

test("still removes the worktree when removing a finished brief's labels fails, and doesn't retry", () => {
  const logs: string[] = [];
  const h = harness({
    issues: [issue(13, [LABELS.review], { state: 'CLOSED' })],
    state: { briefs: { 13: tracked(13) } },
    prs: { 'brief/13-brief-13': { number: 130, url: 'u', state: 'MERGED', reviews: [] } },
    failLabels: true,
  });
  h.deps.log = (m) => logs.push(m);
  tick(h.deps);
  assert.deepEqual(h.removed, [tracked(13).worktree]);
  assert.equal(h.state.briefs[13], undefined);
  assert.ok(logs.some((m) => m.includes('#13: gh failed')));
  tick(h.deps);
  assert.deepEqual(h.removed, [tracked(13).worktree], 'the next tick no longer tracks the brief');
});

test('the Notification hook moves the brief to needs-input and posts the question', () => {
  const h = harness({ issues: [issue(5, [LABELS.working])], state: { briefs: { 5: tracked(5) } } });
  const deps = { state: h.state, github: () => h.deps.github, log() {} };
  onNotification({ session_id: 'session-5', cwd: tracked(5).worktree, notification_type: 'idle_prompt' }, deps);
  assert.deepEqual(h.issues.get(5)!.labels, [LABELS.needsInput]);
  assert.match(h.comments[0].body, /needs input/);
  assert.match(h.comments[0].body, /claude attach brief-5-brief-5/);

  // Only reported once, and Dan's answer moves it back to working.
  onNotification({ session_id: 'session-5', notification_type: 'idle_prompt' }, deps);
  assert.equal(h.comments.length, 1);
  onPromptSubmit({ session_id: 'session-5' }, deps);
  assert.deepEqual(h.issues.get(5)!.labels, [LABELS.working]);
});

test("the Notification hook ignores agent sessions it didn't start and briefs in review", () => {
  const h = harness({ issues: [issue(5, [LABELS.review])], state: { briefs: { 5: tracked(5) } } });
  const deps = { state: h.state, github: () => h.deps.github, log() {} };
  onNotification({ session_id: 'someone-else', cwd: '/home/dan/project', notification_type: 'idle_prompt' }, deps);
  onNotification({ session_id: 'session-5', notification_type: 'idle_prompt' }, deps);
  assert.equal(h.comments.length, 0);
  assert.deepEqual(h.issues.get(5)!.labels, [LABELS.review]);
});
