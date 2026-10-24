// Runs the commands in-process with @crustjs/testing.
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { startReviewServer, type ReviewServer } from '@agent-diff/server';
import { readConfig, statePaths } from '@agent-diff/shared/state';
import { captureExecute } from '@crustjs/testing';
import { createApp, type AppOptions } from '../src/app.ts';
import {
  createClient,
  notRunningMessage,
  rejectedTokenMessage,
} from '../src/client.ts';
import {
  git,
  makeRepo,
  otherToken,
  saveConfig,
  tempDir,
  tempStateHome,
} from './helpers.ts';

const isoTimestamp = String.raw`\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z`;

async function startServer(t: TestContext, env: NodeJS.ProcessEnv) {
  const server = await startReviewServer({ env });
  t.after(() => server.close());
  return server;
}

// Runs a command with no terminal to confirm in, unless options say
// otherwise.
function run(
  env: NodeJS.ProcessEnv,
  args: string[],
  options: Omit<AppOptions, 'env'> = {},
) {
  return captureExecute(createApp({ env, confirm: null, ...options }), args);
}

function url(server: ReviewServer, id: string): string {
  return `http://127.0.0.1:${server.port}/sessions/${id}#token=${server.token}`;
}

// Creates a session and returns its ID.
async function newSession(
  env: NodeJS.ProcessEnv,
  args: string[],
): Promise<string> {
  const result = await run(env, ['session', 'new', ...args]);
  assert.equal(result.exitCode, 0, result.stderr);
  return /^Created session (s_[0-9a-z]{6})\.$/m.exec(result.stdout)![1]!;
}

test('server start without --foreground fails', async (t) => {
  const env = tempStateHome(t);
  const result = await run(env, ['server', 'start']);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, '');
  assert.equal(
    result.stderr,
    'Error: Only `agent-diff server start --foreground` is supported for now.',
  );
  assert.equal(readConfig(statePaths(env)), undefined);
});

test('server start says so when the review server is already running, with its port and no URL', async (t) => {
  const env = tempStateHome(t);
  const server = await startServer(t, env);

  const result = await run(env, ['server', 'start', '--foreground']);
  assert.deepEqual(result, {
    stdout: `The review server is already running on port ${server.port}.`,
    stderr: '',
    exitCode: 0,
  });
  assert.deepEqual(readConfig(statePaths(env)), {
    port: server.port,
    token: server.token,
  });
});

test('session new prints the ID, the URL with the token, and each working directory', async (t) => {
  const env = tempStateHome(t);
  const server = await startServer(t, env);
  const repo = makeRepo(t, env);
  const plain = tempDir(t);

  const result = await run(env, [
    'session',
    'new',
    '--title',
    'Check',
    repo,
    plain,
  ]);
  assert.equal(result.exitCode, 0, result.stderr);
  const id = /^Created session (s_[0-9a-z]{6})\./.exec(result.stdout)![1]!;
  assert.equal(
    result.stdout,
    [
      `Created session ${id}.`,
      `Review UI: ${url(server, id)}`,
      'Working directories:',
      `  ${repo} (base ref main)`,
      `  ${plain} (doesn't use git)`,
    ].join('\n'),
  );
  assert.equal(result.stderr, '');
  assert.match(
    (await run(env, ['session', 'show', id])).stdout,
    /^Session s_[0-9a-z]{6}: Check$/m,
  );
});

test('session new resolves relative paths against the current directory', async (t) => {
  const env = tempStateHome(t);
  await startServer(t, env);
  const parent = tempDir(t);
  mkdirSync(path.join(parent, 'a'));
  const result = await run(env, ['session', 'new', 'a', '.'], {
    cwd: parent,
  });
  assert.match(
    result.stdout,
    new RegExp(
      `Working directories:\n  ${parent}/a \\(doesn't use git\\)\n  ${parent} \\(doesn't use git\\)$`,
    ),
  );
});

test('session new applies --base to every working directory that uses git', async (t) => {
  const env = tempStateHome(t);
  await startServer(t, env);
  const repo = makeRepo(t, env);
  const plain = tempDir(t);
  const result = await run(env, [
    'session',
    'new',
    '--base',
    'HEAD',
    repo,
    plain,
  ]);
  assert.match(
    result.stdout,
    new RegExp(
      `\n  ${repo} \\(base ref HEAD\\)\n  ${plain} \\(doesn't use git\\)$`,
    ),
  );
});

test('session new fails, adding nothing, in each case', async (t) => {
  const env = tempStateHome(t);
  await startServer(t, env);
  const repo = makeRepo(t, env);
  const missing = path.join(tempDir(t), 'missing');
  for (const [args, stderr] of [
    [[], 'Error: Missing required argument "<working-dir>"'],
    [[repo, missing], `Error: The working directory ${missing} doesn't exist.`],
    [
      ['--base', 'nope', repo],
      `Error: The base ref nope doesn't resolve to a commit in ${repo}.`,
    ],
    [['--title', '', repo], 'Error: The title must not be empty.'],
    [
      ['--title', 'T'.repeat(201), repo],
      'Error: The title must be at most 200 characters.',
    ],
  ] as const) {
    assert.deepEqual(
      await run(env, ['session', 'new', ...args]),
      { stdout: '', stderr, exitCode: 1 },
      args.join(' '),
    );
  }
  assert.equal(
    (await run(env, ['session', 'list', '--all'])).stdout,
    'There are no sessions.',
  );
});

test('session add prints the working directories it added, and marks the ones already in the session', async (t) => {
  const env = tempStateHome(t);
  await startServer(t, env);
  const repo = makeRepo(t, env);
  const third = tempDir(t);
  const id = await newSession(env, [repo]);

  assert.deepEqual(
    await run(env, ['session', 'add', '--base', 'HEAD', id, repo, third]),
    {
      stdout: [
        `Added to session ${id}:`,
        `  ${third} (doesn't use git)`,
        `Already in session ${id}, and kept as they were:`,
        `  ${repo} (base ref main)`,
      ].join('\n'),
      stderr: '',
      exitCode: 0,
    },
  );
  const other = makeRepo(t, env);
  assert.deepEqual(await run(env, ['session', 'add', id, other]), {
    stdout: [`Added to session ${id}:`, `  ${other} (base ref main)`].join(
      '\n',
    ),
    stderr: '',
    exitCode: 0,
  });
  assert.deepEqual(await run(env, ['session', 'add', id, repo]), {
    stdout: [
      `Already in session ${id}, and kept as they were:`,
      `  ${repo} (base ref main)`,
    ].join('\n'),
    stderr: '',
    exitCode: 0,
  });
});

test('session add fails on an archived session', async (t) => {
  const env = tempStateHome(t);
  await startServer(t, env);
  const id = await newSession(env, [tempDir(t)]);
  await run(env, ['session', 'archive', id]);
  assert.deepEqual(await run(env, ['session', 'add', id, tempDir(t)]), {
    stdout: '',
    stderr: `Error: Session ${id} is archived, so working directories can't be added to it.`,
    exitCode: 1,
  });
});

test('session show prints the session, its status, its URL, and its working directories', async (t) => {
  const env = tempStateHome(t);
  const server = await startServer(t, env);
  const repo = makeRepo(t, env);
  const gone = tempDir(t);
  const id = await newSession(env, ['--title', 'Check', repo, gone]);
  rmSync(gone, { recursive: true });

  const shown = await run(env, ['session', 'show', id]);
  assert.equal(shown.exitCode, 0, shown.stderr);
  assert.match(
    shown.stdout,
    new RegExp(
      `^${[
        `Session ${id}: Check`,
        'Status: active',
        `Created: ${isoTimestamp}`,
        `Review UI: ${url(server, id).replace(/[.?+]/g, '\\$&')}`,
        'No comments\\.',
        'Working directories:',
        `  ${repo} \\(base ref main\\)`,
        `  ${gone} \\(doesn't use git, missing on disk\\)`,
      ].join('\n')}$`,
    ),
  );

  await run(env, ['session', 'archive', id]);
  assert.match(
    (await run(env, ['session', 'show', id])).stdout,
    new RegExp(`\nStatus: archived on ${isoTimestamp}\n`),
  );

  const untitled = await newSession(env, [repo]);
  assert.match(
    (await run(env, ['session', 'show', untitled])).stdout,
    new RegExp(`^Session ${untitled}\nStatus: active\n`),
  );
});

test('session list lists active sessions newest first, and --all includes archived ones', async (t) => {
  const env = tempStateHome(t);
  await startServer(t, env);
  const repo = makeRepo(t, env);
  const plain = tempDir(t);
  const first = await newSession(env, ['--title', 'First', repo]);
  const second = await newSession(env, [plain, repo]);
  const third = await newSession(env, [plain]);
  await run(env, ['session', 'archive', second]);

  assert.match(
    (await run(env, ['session', 'list'])).stdout,
    new RegExp(
      `^${[
        `${third} \\(created ${isoTimestamp}\\)`,
        `  ${plain}`,
        `${first}: First \\(created ${isoTimestamp}\\)`,
        `  ${repo}`,
      ].join('\n')}$`,
    ),
  );
  assert.match(
    (await run(env, ['session', 'list', '--all'])).stdout,
    new RegExp(
      `^${[
        `${third} \\(created ${isoTimestamp}\\)`,
        `  ${plain}`,
        `${second} \\(created ${isoTimestamp}, archived ${isoTimestamp}\\)`,
        `  ${plain}`,
        `  ${repo}`,
        `${first}: First \\(created ${isoTimestamp}\\)`,
        `  ${repo}`,
      ].join('\n')}$`,
    ),
  );
});

test('session list says when there are no sessions', async (t) => {
  const env = tempStateHome(t);
  await startServer(t, env);
  assert.deepEqual(await run(env, ['session', 'list']), {
    stdout: 'There are no active sessions.',
    stderr: '',
    exitCode: 0,
  });
  assert.equal(
    (await run(env, ['session', 'list', '--all'])).stdout,
    'There are no sessions.',
  );
});

test('session archive archives a session, and succeeds when it is already archived', async (t) => {
  const env = tempStateHome(t);
  await startServer(t, env);
  const id = await newSession(env, [tempDir(t)]);
  assert.deepEqual(await run(env, ['session', 'archive', id]), {
    stdout: `Archived session ${id}.`,
    stderr: '',
    exitCode: 0,
  });
  const again = await run(env, ['session', 'archive', id]);
  assert.equal(again.exitCode, 0);
  assert.match(
    again.stdout,
    new RegExp(`^Session ${id} was already archived on ${isoTimestamp}\\.$`),
  );
  assert.equal(
    (await run(env, ['session', 'list'])).stdout,
    'There are no active sessions.',
  );
});

test('session delete --yes deletes the session without asking', async (t) => {
  const env = tempStateHome(t);
  await startServer(t, env);
  const id = await newSession(env, [tempDir(t)]);
  const questions: string[] = [];
  const confirm = async (question: string) => {
    questions.push(question);
    return false;
  };
  assert.deepEqual(
    await run(env, ['session', 'delete', '--yes', id], { confirm }),
    {
      stdout: `Deleted session ${id}.`,
      stderr: '',
      exitCode: 0,
    },
  );
  assert.deepEqual(questions, []);
  assert.equal(
    (await run(env, ['session', 'list', '--all'])).stdout,
    'There are no sessions.',
  );
});

test('session delete asks in a terminal, and deletes only when the answer is yes', async (t) => {
  const env = tempStateHome(t);
  await startServer(t, env);
  const id = await newSession(env, ['--title', 'Check', tempDir(t)]);
  const questions: string[] = [];
  const answer = (yes: boolean) => async (question: string) => {
    questions.push(question);
    return yes;
  };

  assert.deepEqual(
    await run(env, ['session', 'delete', id], { confirm: answer(false) }),
    { stdout: `Kept session ${id}.`, stderr: '', exitCode: 0 },
  );
  assert.equal((await run(env, ['session', 'show', id])).exitCode, 0);
  assert.deepEqual(
    await run(env, ['session', 'delete', id], { confirm: answer(true) }),
    { stdout: `Deleted session ${id}.`, stderr: '', exitCode: 0 },
  );
  assert.deepEqual(questions, [
    `Permanently delete session ${id}: Check?`,
    `Permanently delete session ${id}: Check?`,
  ]);
  assert.equal((await run(env, ['session', 'show', id])).exitCode, 1);
});

test('session delete without a terminal fails without --yes, and deletes nothing', async (t) => {
  const env = tempStateHome(t);
  await startServer(t, env);
  const id = await newSession(env, [tempDir(t)]);
  assert.deepEqual(await run(env, ['session', 'delete', id]), {
    stdout: '',
    stderr: `Error: There's no terminal to confirm in, so pass --yes to delete session ${id}.`,
    exitCode: 1,
  });
  assert.equal((await run(env, ['session', 'show', id])).exitCode, 0);
});

test('session delete keeps working directories that are still in another session', async (t) => {
  const env = tempStateHome(t);
  await startServer(t, env);
  const repo = makeRepo(t, env);
  const first = await newSession(env, [repo]);
  const second = await newSession(env, [repo]);
  await run(env, ['session', 'delete', '--yes', first]);
  assert.match(
    (await run(env, ['session', 'show', second])).stdout,
    new RegExp(`\n  ${repo} \\(base ref main\\)$`),
  );
});

test('session commands fail with a readable error for an unknown or malformed ID', async (t) => {
  const env = tempStateHome(t);
  await startServer(t, env);
  const dir = tempDir(t);
  for (const id of ['s_7kq9a1', 'nope']) {
    for (const args of [
      ['session', 'show', id],
      ['session', 'add', id, dir],
      ['session', 'archive', id],
      ['session', 'delete', '--yes', id],
      ['session', 'delete', id],
    ]) {
      assert.deepEqual(
        await run(env, args),
        { stdout: '', stderr: `Error: There's no session ${id}.`, exitCode: 1 },
        args.join(' '),
      );
    }
  }
});

const everySessionCommand = (dir: string) => [
  ['session', 'new', dir],
  ['session', 'add', 's_7kq9a1', dir],
  ['session', 'show', 's_7kq9a1'],
  ['session', 'list'],
  ['session', 'archive', 's_7kq9a1'],
  ['session', 'delete', '--yes', 's_7kq9a1'],
  ['session', 'delete', 's_7kq9a1'],
];

test('every session command fails when the review server has never started', async (t) => {
  const env = tempStateHome(t);
  for (const args of everySessionCommand(tempDir(t))) {
    assert.deepEqual(
      await run(env, args),
      { stdout: '', stderr: `Error: ${notRunningMessage}`, exitCode: 1 },
      args.join(' '),
    );
  }
});

test('every session command fails when nothing listens on the saved port', async (t) => {
  const env = tempStateHome(t);
  // A port that was free a moment ago.
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as AddressInfo).port;
  await new Promise((resolve) => probe.close(resolve));
  saveConfig(env, { port, token: otherToken() });

  for (const args of everySessionCommand(tempDir(t))) {
    assert.deepEqual(
      await run(env, args),
      { stdout: '', stderr: `Error: ${notRunningMessage}`, exitCode: 1 },
      args.join(' '),
    );
  }
});

test('session commands fail when the config file is not valid', async (t) => {
  const env = tempStateHome(t);
  const server = await startServer(t, env);
  saveConfig(env, { port: server.port });

  assert.deepEqual(await run(env, ['session', 'list']), {
    stdout: '',
    stderr: `Error: ${notRunningMessage}`,
    exitCode: 1,
  });
});

test('session commands say the token was rejected when the review server answers 401', async (t) => {
  const env = tempStateHome(t);
  const server = await startServer(t, env);
  saveConfig(env, { port: server.port, token: otherToken() });

  const config = statePaths(env).config;
  assert.equal(
    rejectedTokenMessage(server.port, config),
    `Something on port ${server.port} rejected the token in \`${config}\`. Start the review server with \`agent-diff server start\`.`,
  );
  assert.deepEqual(await run(env, ['session', 'list']), {
    stdout: '',
    stderr: `Error: ${rejectedTokenMessage(server.port, config)}`,
    exitCode: 1,
  });
});

test('a directory inside a repo uses git, with the default base ref', async (t) => {
  const env = tempStateHome(t);
  await startServer(t, env);
  const repo = makeRepo(t, env);
  git(env, repo, 'switch', '--quiet', 'main');
  const inside = path.join(repo, 'src');
  mkdirSync(inside);
  const result = await run(env, ['session', 'new', inside]);
  assert.match(result.stdout, new RegExp(`\n  ${inside} \\(base ref HEAD\\)$`));
});

// Writes comments in the session's draft review through the API, as the
// review UI does, submits it, and returns the review's and comments' IDs.
async function submitReview(
  server: ReviewServer,
  sessionId: string,
  ...texts: string[]
) {
  const api = createClient(server.port, server.token);
  const ids: string[] = [];
  for (const text of texts) {
    ids.push((await api.comment.add({ sessionId, text })).id);
  }
  const review = await api.review.submit({ sessionId });
  return { api, review, ids };
}

// The decision's time format, in the local time zone.
function localTime(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

test('review show prints the review in the shape decision 0043 gives', async (t) => {
  const env = tempStateHome(t);
  const server = await startServer(t, env);
  const sessionId = await newSession(env, [tempDir(t)]);
  const { api, review, ids } = await submitReview(
    server,
    sessionId,
    'Split the migration into its own commit.',
    'Use the config file for the port.',
    'Rename it.',
  );
  await api.comment.reply({
    id: ids[1]!,
    status: 'addressed',
    text: 'Read the port from the config file in server.ts.',
  });
  await api.comment.reply({
    id: ids[2]!,
    status: 'needs_input',
    text: 'To what?',
  });
  await api.comment.add({ sessionId, text: 'Still in the draft review' });

  assert.deepEqual(await run(env, ['review', 'show', review.id]), {
    stdout: [
      `Review ${review.id} in session ${sessionId}, submitted ${localTime(review.submittedAt)}.`,
      'Address each comment, then reply to it with one of:',
      '  agent-diff comment reply <comment-id> --addressed <what changed>',
      '  agent-diff comment reply <comment-id> --needs-input <your question>',
      '',
      '## Overall comments',
      '',
      `### ${ids[0]} (open)`,
      '',
      'Reviewer: Split the migration into its own commit.',
      '',
      `### ${ids[1]} (addressed)`,
      '',
      'Reviewer: Use the config file for the port.',
      'Agent, addressed: Read the port from the config file in server.ts.',
      '',
      `### ${ids[2]} (needs input)`,
      '',
      'Reviewer: Rename it.',
      'Agent, needs input: To what?',
    ].join('\n'),
    stderr: '',
    exitCode: 0,
  });
});

test('review show works on an archived session, and shows resolved comments', async (t) => {
  const env = tempStateHome(t);
  const server = await startServer(t, env);
  const sessionId = await newSession(env, [tempDir(t)]);
  const { api, review, ids } = await submitReview(server, sessionId, 'One');
  await api.comment.resolve({ id: ids[0]! });
  await run(env, ['session', 'archive', sessionId]);
  const shown = await run(env, ['review', 'show', review.id]);
  assert.equal(shown.exitCode, 0, shown.stderr);
  assert.match(shown.stdout, new RegExp(`\n### ${ids[0]} \\(resolved\\)\n`));
});

test('review show fails with a readable error for an unknown or malformed ID', async (t) => {
  const env = tempStateHome(t);
  await startServer(t, env);
  for (const id of ['r_7kq9a1', 'nope']) {
    assert.deepEqual(await run(env, ['review', 'show', id]), {
      stdout: '',
      stderr: `Error: There's no review ${id}.`,
      exitCode: 1,
    });
  }
});

test('comment reply adds the reply, sets the status from its flag, and works twice in a row', async (t) => {
  const env = tempStateHome(t);
  const server = await startServer(t, env);
  const sessionId = await newSession(env, [tempDir(t)]);
  const { api, review, ids } = await submitReview(server, sessionId, 'One');
  const id = ids[0]!;
  assert.deepEqual(
    await run(env, ['comment', 'reply', id, '--addressed', 'Done.']),
    {
      stdout: `Replied to ${id}. It's now addressed.`,
      stderr: '',
      exitCode: 0,
    },
  );
  assert.deepEqual(
    await run(env, ['comment', 'reply', id, '--needs-input', 'Which one?']),
    {
      stdout: `Replied to ${id}. It now needs input.`,
      stderr: '',
      exitCode: 0,
    },
  );
  const [comment] = (await api.review.show({ id: review.id })).comments;
  assert.equal(comment!.status, 'needs_input');
  assert.deepEqual(
    comment!.replies.map((reply) => [reply.status, reply.text]),
    [
      ['addressed', 'Done.'],
      ['needs_input', 'Which one?'],
    ],
  );
});

test('comment reply works on a resolved comment', async (t) => {
  const env = tempStateHome(t);
  const server = await startServer(t, env);
  const sessionId = await newSession(env, [tempDir(t)]);
  const { api, ids } = await submitReview(server, sessionId, 'One');
  await api.comment.resolve({ id: ids[0]! });
  assert.deepEqual(
    await run(env, ['comment', 'reply', ids[0]!, '--addressed', 'Done.']),
    {
      stdout: `Replied to ${ids[0]}. It's now addressed.`,
      stderr: '',
      exitCode: 0,
    },
  );
});

test('comment reply needs exactly one of --addressed and --needs-input', async (t) => {
  const env = tempStateHome(t);
  const server = await startServer(t, env);
  const sessionId = await newSession(env, [tempDir(t)]);
  const { api, review, ids } = await submitReview(server, sessionId, 'One');
  for (const flags of [
    [],
    ['--addressed', 'Done.', '--needs-input', 'Which?'],
  ]) {
    assert.deepEqual(
      await run(env, ['comment', 'reply', ids[0]!, ...flags]),
      {
        stdout: '',
        stderr: 'Error: Give exactly one of --addressed and --needs-input.',
        exitCode: 1,
      },
      flags.join(' '),
    );
  }
  assert.deepEqual(
    await run(env, ['comment', 'reply', ids[0]!, '--addressed', ' ']),
    { stdout: '', stderr: 'Error: The reply must not be empty.', exitCode: 1 },
  );
  const [comment] = (await api.review.show({ id: review.id })).comments;
  assert.deepEqual([comment!.status, comment!.replies], ['open', []]);
});

test('comment reply fails on a comment in the draft review, on an archived session, and for an unknown or malformed ID', async (t) => {
  const env = tempStateHome(t);
  const server = await startServer(t, env);
  const sessionId = await newSession(env, [tempDir(t)]);
  const { api, ids } = await submitReview(server, sessionId, 'One');
  const draft = await api.comment.add({ sessionId, text: 'Draft' });
  for (const id of [draft.id, 'c_7kq9a1', 'nope']) {
    assert.deepEqual(
      await run(env, ['comment', 'reply', id, '--addressed', 'Done.']),
      { stdout: '', stderr: `Error: There's no comment ${id}.`, exitCode: 1 },
    );
  }
  await run(env, ['session', 'archive', sessionId]);
  assert.deepEqual(
    await run(env, ['comment', 'reply', ids[0]!, '--needs-input', 'Why?']),
    {
      stdout: '',
      stderr: `Error: Session ${sessionId} is archived, so its comments can't be replied to.`,
      exitCode: 1,
    },
  );
});

test('session show counts submitted comments by status, leaving out the draft review', async (t) => {
  const env = tempStateHome(t);
  const server = await startServer(t, env);
  const sessionId = await newSession(env, [tempDir(t)]);
  const commentsLine = async () =>
    /^.*comments?.*$/m.exec(
      (await run(env, ['session', 'show', sessionId])).stdout,
    )?.[0];
  const first = await submitReview(server, sessionId, 'A');
  assert.equal(await commentsLine(), '1 comment: 1 open.');
  const { api, ids } = await submitReview(
    server,
    sessionId,
    'B',
    'C',
    'D',
    'E',
  );
  const [b, c, d, e] = ids;
  await api.comment.reply({ id: b!, status: 'addressed', text: 'Done.' });
  await api.comment.reply({ id: c!, status: 'needs_input', text: '?' });
  await api.comment.resolve({ id: d! });
  await api.comment.resolve({ id: e! });
  await api.comment.add({ sessionId, text: 'In the draft review' });
  assert.equal(
    await commentsLine(),
    '5 comments: 1 open, 1 addressed, 1 needs input, 2 resolved.',
  );
  for (const id of [first.ids[0]!, b!, c!]) await api.comment.resolve({ id });
  assert.equal(await commentsLine(), '5 comments: 5 resolved.');
});
