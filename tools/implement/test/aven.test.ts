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
import {
  cliAven,
  parseListedTasks,
  parseNoteId,
  parseTask,
} from '../src/aven.ts';

// Real `aven` output, captured from a scratch database with
// `aven --db <temp file>` (aven 0.1.50, and 0.1.51 for notes and retry).
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
    notes: [
      {
        id: '2R6QFT3NTT6SBFDH',
        body: 'Pull request: https://github.com/danschultz/agent-diff/pull/50',
        createdAt: '2026-10-20T04:28:26Z',
      },
    ],
  });
});

test("parses a task's notes in the order `aven show` lists them, oldest first", () => {
  const task = parseTask(fixture('aven-show-with-notes.json'));
  assert.equal(task.agent, 'retry');
  assert.deepEqual(task.notes, [
    {
      id: 'JTT79821E1MTEXY9',
      body: 'Pull request: none yet',
      createdAt: '2026-10-24T05:07:00Z',
    },
    {
      id: 'VEQT3DM4D94Z4RS6',
      body: 'The agent session exited without opening a pull request.\n',
      createdAt: '2026-10-24T05:07:02Z',
    },
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
  ]);
});

test("parses the new note's ID from `aven note` output", () => {
  assert.equal(
    parseNoteId('noted AD-4QZJ note=VEQT3DM4D94Z4RS6\n'),
    'VEQT3DM4D94Z4RS6',
  );
  assert.throws(() => parseNoteId('something else\n'), /note ID/);
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

test('listed tasks are oldest first, by their stable IDs, with their refs', () => {
  // `aven list` prints the newest first.
  assert.deepEqual(
    parseListedTasks(fixture('aven-list-queued.json')).map((t) => t.id),
    ['88VWSKVMNZ8YABGV', 'ES1QEGZ8WSDP27YG'],
  );
  assert.deepEqual(parseListedTasks(fixture('aven-list-retry.json')), [
    { id: '4QZJM6N08YK6QAZD', ref: 'AD-4QZJ' },
    { id: 'FMQBPBKZJ155DE5G', ref: 'AD-FMQB' },
    { id: 'XD72SG3PX4XG3YTD', ref: 'AD-XD72' },
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
  note) cat > '${dir}/stdin'; echo "noted AD-FBRW note=VEQT3DM4D94Z4RS6" ;;
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

test("adds a note from standard input, and returns the note's ID", (t) => {
  const fake = fakeAven(t);
  const id = cliAven(fake.bin, 'agent-diff').note(
    'FBRWXFZBHJ12W7FF',
    'Line one\n\n`code`',
  );
  assert.deepEqual(fake.calls(), [['note', 'FBRWXFZBHJ12W7FF', '--stdin']]);
  assert.equal(fake.stdin(), 'Line one\n\n`code`');
  assert.equal(id, 'VEQT3DM4D94Z4RS6');
});

test('lists open tasks with agent=retry in the configured project, without reading each one', (t) => {
  const fake = fakeAven(t);
  const tasks = cliAven(fake.bin, 'agent-diff').retryTasks();
  assert.deepEqual(fake.calls(), [
    [
      'list',
      '--project',
      'agent-diff',
      '--open',
      '--metadata',
      'agent=retry',
      '--limit',
      '100',
      '--json',
    ],
  ]);
  assert.deepEqual(tasks, [
    { id: '88VWSKVMNZ8YABGV', ref: 'AD-88VW' },
    { id: 'ES1QEGZ8WSDP27YG', ref: 'AD-ES1Q' },
  ]);
});
