import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LABELS } from '../src/config.ts';
import { clearLabels, type GitHub } from '../src/github.ts';

const ALL_LABELS = Object.values(LABELS);

function fakeGitHub() {
  const calls: { issue: number; add: string[]; remove: string[] }[] = [];
  const github = { setLabels: (issue: number, add: string[], remove: string[]) => calls.push({ issue, add, remove }) } as unknown as GitHub;
  return { github, calls };
}

test('clearing labels removes every agent label and leaves the others', () => {
  const { github, calls } = fakeGitHub();
  const issue = { number: 7, labels: ['bug', LABELS.review, 'tools', LABELS.failed] };
  assert.deepEqual(clearLabels(github, issue, ALL_LABELS), [LABELS.review, LABELS.failed]);
  assert.deepEqual(calls, [{ issue: 7, add: [], remove: [LABELS.review, LABELS.failed] }]);
  assert.deepEqual(issue.labels, ['bug', 'tools']);
});

test("clearing labels doesn't call GitHub when there are no agent labels", () => {
  const { github, calls } = fakeGitHub();
  const issue = { number: 7, labels: ['bug'] };
  assert.deepEqual(clearLabels(github, issue, ALL_LABELS), []);
  assert.deepEqual(calls, []);
});
