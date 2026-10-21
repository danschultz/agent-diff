import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { cliAven, parseQueuedIds, parseTask } from '../src/aven.ts';

// Real `aven --json` output, captured from a scratch database with
// `aven --db <temp file>` (aven 0.1.50).
const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, 'fixtures', name), 'utf8');

test('parses a task from `aven show --full --json`', () => {
  assert.deepEqual(parseTask(fixture('aven-show.json')), {
    id: 'FBRWXFZBHJ12W7FF',
    ref: 'AD-FBRW',
    title: 'Add a version flag',
    description:
      '### Goal\n\nAdd a `--version` flag.\n\n### Acceptance criteria\n\n- `agent-diff --version` prints the version.\n',
    status: 'active',
    agent: 'review',
    blockers: [],
  });
});

test("parses a task's blockers, with each one's status and whether it's deleted", () => {
  const task = parseTask(fixture('aven-show-with-blockers.json'));
  assert.deepEqual(task.blockers, [
    {
      id: 'M5RDA25QV2AY38SP',
      ref: 'OTH-M5RD',
      title: 'Blocker open',
      status: 'inbox',
      deleted: false,
    },
    {
      id: 'QHPQ9MRZKKXJGXXD',
      ref: 'AD-QHPQ',
      title: 'Blocker deleted',
      status: 'inbox',
      deleted: true,
    },
    {
      id: 'MVYNP6QC8HCXMY7D',
      ref: 'AD-MVYN',
      title: 'Blocker done',
      status: 'done',
      deleted: false,
    },
    {
      id: 'DNP7A80YH2S0DNW7',
      ref: 'AD-DNP7',
      title: 'Blocker canceled',
      status: 'canceled',
      deleted: false,
    },
  ]);
});

test('a task without agent metadata has no agent state', () => {
  const task = parseTask(fixture('aven-show-without-agent.json'));
  assert.equal(task.agent, undefined);
  assert.equal(task.status, 'canceled');
});

test('queued tasks are listed oldest first, by their stable IDs', () => {
  // `aven list` prints the newest first.
  assert.deepEqual(parseQueuedIds(fixture('aven-list-queued.json')), [
    '88VWSKVMNZ8YABGV',
    'ES1QEGZ8WSDP27YG',
  ]);
});

/**
 * A fake `aven` that records its arguments and standard input, and prints a
 * fixture for `list` and `show`.
 */
function fakeAven(t: TestContext) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'implement-aven-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'aven');
  const list = path.join(dir, 'list.json');
  const show = path.join(dir, 'show.json');
  writeFileSync(list, fixture('aven-list-queued.json'));
  writeFileSync(show, fixture('aven-show.json'));
  writeFileSync(
    bin,
    `#!/bin/sh
printf '%s\\n' "$@" >> '${dir}/calls'
echo --- >> '${dir}/calls'
case "$1" in
  list) cat '${list}' ;;
  show) cat '${show}' ;;
  note) cat > '${dir}/stdin' ;;
esac
`,
  );
  chmodSync(bin, 0o755);
  const calls = () =>
    readFileSync(path.join(dir, 'calls'), 'utf8')
      .split('---\n')
      .filter(Boolean)
      .map((call) => call.trimEnd().split('\n'));
  const stdin = () => readFileSync(path.join(dir, 'stdin'), 'utf8');
  return { bin, calls, stdin };
}

test('lists only open tasks queued in the configured project', (t) => {
  const fake = fakeAven(t);
  const tasks = cliAven(fake.bin, 'agent-diff').queuedTasks();
  const [list, ...shows] = fake.calls();
  assert.deepEqual(list, [
    'list',
    '--project',
    'agent-diff',
    '--open',
    '--metadata',
    'agent=queued',
    '--limit',
    '100',
    '--json',
  ]);
  // Each queued task is read in full, for its description and metadata.
  assert.deepEqual(shows, [
    ['show', '88VWSKVMNZ8YABGV', '--full', '--json'],
    ['show', 'ES1QEGZ8WSDP27YG', '--full', '--json'],
  ]);
  assert.equal(tasks.length, 2);
});

test('edits a task by its ID, setting and removing the agent metadata', (t) => {
  const fake = fakeAven(t);
  const aven = cliAven(fake.bin, 'agent-diff');
  aven.edit('FBRWXFZBHJ12W7FF', { status: 'active', agent: 'working' });
  aven.edit('FBRWXFZBHJ12W7FF', { status: 'done', agent: null });
  aven.edit('FBRWXFZBHJ12W7FF', {});
  assert.deepEqual(fake.calls(), [
    [
      'edit',
      'FBRWXFZBHJ12W7FF',
      '--status',
      'active',
      '--metadata',
      'agent=working',
    ],
    [
      'edit',
      'FBRWXFZBHJ12W7FF',
      '--status',
      'done',
      '--remove-metadata',
      'agent',
    ],
  ]);
});

test('adds a note from standard input', (t) => {
  const fake = fakeAven(t);
  cliAven(fake.bin, 'agent-diff').note(
    'FBRWXFZBHJ12W7FF',
    'Line one\n\n`code`',
  );
  assert.deepEqual(fake.calls(), [['note', 'FBRWXFZBHJ12W7FF', '--stdin']]);
  assert.equal(fake.stdin(), 'Line one\n\n`code`');
});
