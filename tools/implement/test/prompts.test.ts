import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Note, Task } from '../src/aven.ts';
import type { PullRequest, Review } from '../src/github.ts';
import { resumePrompt, retryPrompt, startPrompt } from '../src/prompts.ts';
import type { BriefState } from '../src/state.ts';

const brief: BriefState = {
  taskId: '7KQ9A1X4MV2P8D6R',
  ref: 'AD-7KQ9',
  repo: 'dan/agent-diff',
  title: 'Do it',
  branch: 'brief/do-it-3f9a2c',
  worktree: '/repo/.claude/worktrees/brief-do-it-3f9a2c',
  sessionName: 'brief-do-it-3f9a2c',
  launchedAt: 0,
  handledReviewIds: [],
};

const task: Task = {
  id: '7KQ9A1X4MV2P8D6R',
  ref: 'AD-7KQ9',
  title: 'Do it',
  description: '### Goal\n\nDo it as written.',
  status: 'active',
  agent: 'working',
  blockers: [],
  notes: [],
};

const review: Review = {
  id: 'r1',
  author: 'dan',
  state: 'CHANGES_REQUESTED',
  body: 'Fix it.',
  submittedAt: '2026-10-16T00:00:00Z',
};

const pr: PullRequest = {
  number: 12,
  url: 'https://github.com/dan/agent-diff/pull/12',
  state: 'OPEN',
  reviews: [review],
};

/** The prompt with its line wrapping undone, so phrases match across lines. */
function unwrapped(prompt: string): string {
  return prompt.replace(/\s+/g, ' ');
}

const notes: Note[] = [
  {
    id: 'Y3M9D33VE010V2NQ',
    body: 'Use the existing parser.',
    createdAt: '2026-10-24T05:07:03Z',
  },
  {
    id: 'PTVRYR4ZV31Y32N6',
    body: 'Skip step 3.\n\nIt is done.',
    createdAt: '2026-10-24T05:07:04Z',
  },
];

const start = unwrapped(startPrompt(brief, task, 'main'));
const resume = unwrapped(resumePrompt(brief, pr, [review]));
const retryRaw = retryPrompt(brief, notes);
const retry = unwrapped(retryRaw);

/** Where `needle` first appears in `text`, failing if it doesn't. */
function at(text: string, needle: string | RegExp): number {
  const index =
    typeof needle === 'string' ? text.indexOf(needle) : text.search(needle);
  assert.notEqual(index, -1, `expected the prompt to contain ${needle}`);
  return index;
}

test('the start prompt says to read the Context and the files the change touches before editing', () => {
  assert.match(start, /before editing/i);
  assert.match(start, /Context/);
  assert.match(start, /files the change touches/);
});

test('the start prompt says to write a short plan for a brief with more than one step', () => {
  assert.match(start, /short plan/);
  assert.match(start, /more than one step/);
});

test('the start prompt says to match the surrounding code, keep the diff to the brief, and leave unrelated code alone', () => {
  assert.match(start, /match the surrounding code/i);
  assert.match(start, /keep the diff to the brief/i);
  assert.match(start, /unrelated code/);
});

test('the start prompt runs the self-review sub-agent after verification and before pushing', () => {
  const verify = at(start, /run every verification step/);
  const commit = at(start, /Commit everything/);
  const selfReview = at(start, /`self-review` sub-agent/);
  const push = at(start, 'git push -u origin brief/do-it-3f9a2c');
  assert.ok(verify < commit, 'committing comes after verification');
  assert.ok(commit < selfReview, 'everything is committed before self-review');
  assert.ok(selfReview < push, 'self-review comes before pushing');
});

test('the start prompt gives the self-review sub-agent only the ref and the diff range', () => {
  assert.match(start, /only the brief's ref, AD-7KQ9,/);
  assert.match(start, /origin\/main\.\.\.HEAD/);
  assert.match(start, /not your summary or reasoning/i);
});

test('the start prompt fixes agreed findings test-first and reruns the verification steps', () => {
  assert.match(start, /findings you agree with, test-first/);
  assert.match(start, /rerun the verification steps/i);
});

test('the start prompt allows a second self-review round only after substantial fixes, and at most 2', () => {
  assert.match(start, /substantial/);
  assert.match(start, /new `self-review` sub-agent/);
  assert.match(start, /first round's findings and how you handled each/);
  assert.match(start, /at most 2 rounds/i);
});

test('the start prompt adds a Self-review section to the pull request body, with every finding', () => {
  assert.match(
    start,
    /"Self-review" section listing every finding as fixed, declined with the reason, or still open/,
  );
  assert.match(start, /don't block the pull request/);
});

test('the start prompt waits for CI after opening the pull request, and moves the brief to review only once it passes', () => {
  const open = at(start, 'gh pr create --draft');
  const watch = at(start, /gh pr checks <number> --watch/);
  const label = at(start, 'aven edit AD-7KQ9 --metadata agent=review');
  assert.ok(open < watch, 'CI is watched after the pull request opens');
  assert.ok(watch < label, 'the brief moves to review after CI');
  assert.match(start, /only once they pass/);
  assert.match(start, /can't make them pass, stop and ask Dan/);
  assert.match(start, /no checks are reported yet, wait/);
});

test('the resume prompt waits for CI before moving the brief back to review', () => {
  const push = at(resume, /and push/);
  const watch = at(resume, 'gh pr checks 12 --watch');
  const label = at(resume, 'aven edit AD-7KQ9 --metadata agent=review');
  assert.ok(push < watch, 'CI is watched after pushing');
  assert.ok(watch < label, 'the brief moves to review after CI');
  assert.match(resume, /only once they pass/);
  assert.match(resume, /can't make them pass, stop and ask Dan/);
  assert.match(resume, /no checks are reported yet, wait/);
});

test("the resume prompt doesn't run self-review", () => {
  assert.doesNotMatch(resume, /self-review/i);
});

test("the start prompt has the brief's description as written, and says how to read it", () => {
  assert.match(start, /# Brief AD-7KQ9: Do it/);
  assert.ok(
    startPrompt(brief, task, 'main').includes('### Goal\n\nDo it as written.'),
  );
  assert.match(start, /`aven context AD-7KQ9`/);
});

test('the start prompt opens a pull request with no "Closes" line', () => {
  assert.match(start, /Its body has no "Closes" line/);
});

test('the resume prompt leaves the pull request\'s "Closes" line alone, so migrated briefs keep theirs', () => {
  assert.doesNotMatch(resume, /Closes/);
});

test('the prompts keep the ref and task ID out of GitHub and git', () => {
  for (const prompt of [start, resume, retry]) {
    assert.match(
      prompt,
      /Keep AD-7KQ9, and anything else that identifies the brief, such as the task's ID, out of branch names, commits, and pull requests/,
    );
    assert.doesNotMatch(prompt, /7KQ9A1X4MV2P8D6R/);
    assert.doesNotMatch(prompt, /Closes #/);
    assert.doesNotMatch(prompt, /gh issue/);
  }
});

test('the prompts say Dan sees questions as a note on the brief', () => {
  assert.match(start, /adds your question to the brief as a note/);
  assert.match(resume, /adds your question to the brief as a note/);
  assert.match(retry, /adds your question to the brief as a note/);
});

test('the retry prompt ends with the same Aven, escalation and GitHub sections as the other prompts', () => {
  const tail = (prompt: string) =>
    prompt.slice(prompt.indexOf('## The brief in Aven'));
  const retryTail = tail(retryPrompt(brief, notes));
  assert.equal(retryTail, tail(resumePrompt(brief, pr, [review])));
  for (const heading of [
    '## The brief in Aven',
    '## When to stop and ask Dan',
    '## GitHub',
  ])
    assert.ok(retryTail.includes(heading), heading);
});

test("the retry prompt says it exited before finishing, without a pull request, and implement doesn't know why", () => {
  assert.match(retry, /exited before it finished/);
  assert.match(retry, /without opening a pull request/);
  assert.match(retry, /`implement` doesn't know why/);
});

test('the retry prompt says background commands and sub-agents are gone, though their processes may still run', () => {
  assert.match(
    retry,
    /background commands and sub-agents from before are gone/i,
  );
  assert.match(retry, /processes may still be running/);
});

test('the retry prompt says to check git, the pushed branch, and the pull request before going on', () => {
  const check = at(retry, /Before going on/);
  assert.ok(check < at(retry, '`git status`'));
  assert.ok(check < at(retry, '`git log`'));
  assert.match(retry, /whether the branch `brief\/do-it-3f9a2c` is pushed/);
  assert.match(retry, /whether a pull request exists/);
  assert.match(retry, /gh pr list --head brief\/do-it-3f9a2c/);
});

test('the retry prompt says to finish the start prompt\'s "When you\'re done" steps without redoing finished work, including self-review', () => {
  assert.match(retry, /what's left of the "When you're done" steps/);
  assert.match(retry, /without redoing work that's already finished/);
  assert.match(retry, /Self-review still runs/);
  assert.match(retry, /no pull request is open yet/);
});

test('the retry prompt passes every note added since the failure, in order, as instructions from Dan', () => {
  assert.match(retry, /instructions from Dan/);
  const first = at(retryRaw, '    Use the existing parser.');
  const second = at(retryRaw, '    Skip step 3.\n    \n    It is done.');
  assert.ok(first < second, 'oldest first');
  assert.ok(
    second < at(retryRaw, '## The brief in Aven'),
    'the notes come before the shared sections',
  );
  assert.match(retry, /Added 2026-10-24T05:07:03Z/);
});

test('the retry prompt says when no notes were added since the failure', () => {
  const none = unwrapped(retryPrompt(brief, []));
  assert.match(none, /No notes were added to the brief since it failed\./);
  assert.doesNotMatch(none, /instructions from Dan/);
});

test('the start prompt lists the blockers, says they are done, and says to read but not change them', () => {
  const blocked = unwrapped(
    startPrompt(
      brief,
      {
        ...task,
        blockers: [
          {
            id: 'M5RDA25QV2AY38SP',
            ref: 'AD-M5RD',
            title: 'Add the parser',
            status: 'done',
            deleted: false,
          },
          {
            id: 'QHPQ9MRZKKXJGXXD',
            ref: 'OTH-QHPQ',
            title: 'Pick a format',
            status: 'done',
            deleted: false,
          },
        ],
      },
      'main',
    ),
  );
  assert.match(blocked, /- AD-M5RD: Add the parser - OTH-QHPQ: Pick a format/);
  assert.match(blocked, /which are all done/);
  assert.match(blocked, /`aven context <ref>`/);
  assert.match(blocked, /don't change them/);
  assert.match(
    blocked,
    /Keep their refs, and their IDs, out of branch names, commits, and pull requests/,
  );
  assert.doesNotMatch(blocked, /M5RDA25QV2AY38SP|QHPQ9MRZKKXJGXXD/);
});

test('a brief without blockers gets the same start prompt as before, with nothing about blockers', () => {
  assert.doesNotMatch(start, /depends on/);
  assert.doesNotMatch(start, /aven context <ref>/);
});

test("the retry prompt says to read the latest notes when implement couldn't find its failure note", () => {
  const missing = unwrapped(retryPrompt(brief, undefined));
  assert.match(
    missing,
    /couldn't find the note it added when it marked the brief failed/,
  );
  assert.match(missing, /Read the latest notes with `aven context AD-7KQ9`/);
  assert.doesNotMatch(missing, /No notes were added/);
});
