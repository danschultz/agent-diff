import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Issue, PullRequest, Review } from '../src/github.ts';
import { resumePrompt, startPrompt } from '../src/prompts.ts';
import type { BriefState } from '../src/state.ts';

const brief: BriefState = {
  issue: 7,
  repo: 'dan/agent-diff',
  title: 'Do it',
  branch: 'brief/7-do-it',
  worktree: '/repo/.claude/worktrees/brief-7-do-it',
  sessionName: 'brief-7-do-it',
  launchedAt: 0,
  handledReviewIds: [],
};

const issue: Issue = {
  number: 7,
  title: 'Do it',
  body: '### Goal\n\nDo it.',
  url: 'https://github.com/dan/agent-diff/issues/7',
  author: 'dan',
  labels: ['agent:working'],
  state: 'OPEN',
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

const start = unwrapped(startPrompt(brief, issue, 'main'));
const resume = unwrapped(resumePrompt(brief, pr, [review]));

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
  const selfReview = at(start, /`self-review` sub-agent/);
  const push = at(start, 'git push -u origin brief/7-do-it');
  assert.ok(verify < selfReview, 'self-review comes after verification');
  assert.ok(selfReview < push, 'self-review comes before pushing');
});

test('the start prompt gives the self-review sub-agent only the issue number and the diff range', () => {
  assert.match(start, /issue number, #7/);
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
  assert.match(start, /"Self-review" section/);
  assert.match(start, /fixed/);
  assert.match(start, /declined with the reason/);
  assert.match(start, /still open/);
  assert.match(start, /don't block the pull request/);
});

test('the start prompt waits for CI after opening the pull request, and moves the brief to review only once it passes', () => {
  const open = at(start, 'gh pr create --draft');
  const watch = at(start, /gh pr checks <number> --watch/);
  const label = at(start, '--add-label agent:review');
  assert.ok(open < watch, 'CI is watched after the pull request opens');
  assert.ok(watch < label, 'the brief moves to review after CI');
  assert.match(start, /only once they pass/);
  assert.match(start, /can't make them pass, stop and ask Dan/);
});

test('the resume prompt waits for CI before moving the brief back to review', () => {
  const push = at(resume, /and push/);
  const watch = at(resume, 'gh pr checks 12 --watch');
  const label = at(resume, '--add-label agent:review');
  assert.ok(push < watch, 'CI is watched after pushing');
  assert.ok(watch < label, 'the brief moves to review after CI');
  assert.match(resume, /only once they pass/);
  assert.match(resume, /can't make them pass, stop and ask Dan/);
});

test("the resume prompt doesn't run self-review", () => {
  assert.doesNotMatch(resume, /self-review/i);
});
