// The full review loop against an in-process review server: start a review
// session, draft and submit a comment, deliver a notification, fetch
// feedback as the agent, edit the code, and see the live update and the
// comment become outdated.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Db } from '../src/server/db.ts';
import { Api } from '../src/server/http.ts';
import { ReviewService } from '../src/server/service.ts';
import type {
  FeedbackResponse,
  FileDiffResponse,
  FileListResponse,
  PendingFeedback,
  PlacedComment,
  ReviewInfo,
  ReviewSessionInfo,
  ServerEvent,
} from '../src/shared/types.ts';
import { makeRepo, prototypeDir, type TestRepo } from './helpers.ts';

let repo: TestRepo;
let server: Server;
let service: ReviewService;
let base: string;
const events: ServerEvent[] = [];

async function call<T>(method: string, route: string, body?: unknown): Promise<T> {
  const res = await fetch(base + route, {
    method,
    headers: { 'content-type': 'application/json', 'x-agent-diff': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${route}: ${(data as { error: string }).error}`);
  return data as T;
}

async function waitFor<T>(fn: () => T | undefined | null | false, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('timed out');
}

before(async () => {
  repo = makeRepo();
  repo.write('src/user.js', 'export function displayName(user) {\n  return user.profile.name;\n}\n');
  repo.git('add', '.');
  repo.git('commit', '-qm', 'base');
  repo.git('checkout', '-qb', 'agent/work');
  repo.write('src/user.js', 'export function displayName(user) {\n  const name = user.profile.name;\n  return name;\n}\n');

  let api: Api | null = null;
  service = new ReviewService(new Db(path.join(repo.dataDir, 'test.sqlite')), repo.dataDir, (e) => {
    events.push(e);
    api?.broadcast(e);
  });
  service.settings.debounceMs = 50;
  service.settings.enterDelayMs = 0;
  server = createServer((req, res) => void api!.handle(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  api = new Api(service, port);
  base = `http://127.0.0.1:${port}`;
});

after(() => {
  service.shutdown();
  server.close();
  repo.cleanup();
});

describe('review loop', () => {
  let rs: ReviewSessionInfo;
  const notifyLog = () => path.join(repo.dataDir, 'notifications.log');

  it('rejects writes without the write header', async () => {
    const res = await fetch(`${base}/api/review-sessions`, { method: 'POST', body: '{}' });
    assert.equal(res.status, 403);
  });

  it('starts a review session and lists changed files', async () => {
    rs = await call('POST', '/api/review-sessions', { workspaces: [{ path: repo.dir }] });
    assert.equal(rs.workspaces[0].baseRef, 'main');
    const list = await call<FileListResponse>('GET', `/api/review-sessions/${rs.id}/workspaces/${rs.workspaces[0].id}/files?mode=all`);
    assert.deepEqual(list.files.map((f) => [f.status, f.path, f.added, f.removed]), [['modified', 'src/user.js', 2, 1]]);
  });

  it('delivers a notification when a review is submitted, and the agent fetches it', async () => {
    const ws = rs.workspaces[0];
    await call('POST', '/api/agents', {
      id: 'agent-1',
      label: 'test agent',
      notify: `command:printf '%s\\n' "$AGENT_DIFF_MESSAGE" >> '${notifyLog()}'`,
      workspace: repo.dir,
    });

    const file = await call<FileDiffResponse>('GET', `/api/review-sessions/${rs.id}/workspaces/${ws.id}/file?mode=all&path=src/user.js`);
    await call('POST', `/api/review-sessions/${rs.id}/comments`, {
      workspaceId: ws.id,
      path: 'src/user.js',
      side: 'new',
      startLine: 2,
      endLine: 2,
      versionHash: file.new.hash,
      mode: 'all',
      body: 'profile can be missing. Add a null check.',
    });
    await call('POST', `/api/review-sessions/${rs.id}/comments`, { body: 'Looks good otherwise.' });

    const review = await call<ReviewInfo>('POST', `/api/review-sessions/${rs.id}/reviews`);
    assert.equal(review.commentCount, 2);
    assert.equal(review.notifications[0].status, 'sent', review.notifications[0].error ?? '');
    assert.match(readFileSync(notifyLog(), 'utf8'), /review feedback is ready .*feedback --workspace/);

    const pending = await call<PendingFeedback>('GET', `/api/feedback/pending?workspace=${encodeURIComponent(repo.dir)}`);
    assert.equal(pending.pending, true);

    const feedback = await call<FeedbackResponse>('POST', '/api/feedback', { workspace: repo.dir, agentId: 'agent-1' });
    assert.equal(feedback.comments.length, 2);
    const line = feedback.comments.find((c) => c.kind === 'line')!;
    assert.deepEqual(line.original?.code, ['  const name = user.profile.name;']);
    assert.equal(line.current?.state, 'current');

    const after = await call<PendingFeedback>('GET', `/api/feedback/pending?workspace=${encodeURIComponent(repo.dir)}`);
    assert.equal(after.pending, false, 'fetched feedback is no longer pending');
    const [reviewAfter] = await call<ReviewInfo[]>('GET', `/api/review-sessions/${rs.id}/reviews`);
    assert.equal(reviewAfter.notifications[0].status, 'fetched');
  });

  it('pushes a live update when the agent edits, and the addressed comment becomes outdated', async () => {
    const before = events.length;
    repo.write('src/user.js', 'export function displayName(user) {\n  const name = user.profile?.name ?? "Unknown";\n  return name;\n}\n');
    const changed = await waitFor(() => events.slice(before).find((e) => e.type === 'workspace-changed'));
    assert.deepEqual(changed.type === 'workspace-changed' && changed.paths, ['src/user.js']);

    const comments = await call<PlacedComment[]>('GET', `/api/review-sessions/${rs.id}/comments?mode=all`);
    const line = comments.find((c) => c.path)!;
    assert.equal(line.placement?.state, 'outdated');
    assert.deepEqual(line.placement?.replacement, { start: 2, end: 2 });
  });

  it('ignores changes to gitignored files', async () => {
    repo.write('.gitignore', 'build/\n');
    await waitFor(() => events.some((e) => e.type === 'workspace-changed' && e.paths.includes('.gitignore')));
    const before = events.length;
    repo.write('build/out.js', 'generated');
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(events.slice(before).filter((e) => e.type === 'workspace-changed').length, 0);
  });

  it('holds notifications while the agent is mid-turn and lets the stop hook hand them over', async () => {
    const turnStart = await call<{ snapshot: { seq: number } | null }>('POST', '/api/agents/agent-1/turn', { event: 'start', cwd: repo.dir });
    assert.ok(turnStart.snapshot, 'a turn snapshot is recorded at turn start');

    const ws = rs.workspaces[0];
    const file = await call<FileDiffResponse>('GET', `/api/review-sessions/${rs.id}/workspaces/${ws.id}/file?mode=all&path=src/user.js`);
    await call('POST', `/api/review-sessions/${rs.id}/comments`, {
      workspaceId: ws.id,
      path: 'src/user.js',
      side: 'new',
      startLine: 3,
      endLine: 3,
      versionHash: file.new.hash,
      body: 'Inline this.',
    });
    const linesBefore = readFileSync(notifyLog(), 'utf8').split('\n').length;
    const review = await call<ReviewInfo>('POST', `/api/review-sessions/${rs.id}/reviews`);
    assert.equal(review.notifications[0].status, 'held');
    assert.equal(readFileSync(notifyLog(), 'utf8').split('\n').length, linesBefore, 'nothing typed while busy');

    const turnEnd = await call<{ pending: PendingFeedback }>('POST', '/api/agents/agent-1/turn', { event: 'end', cwd: repo.dir, canWake: true });
    assert.equal(turnEnd.pending.pending, true);
    const reviews = await call<ReviewInfo[]>('GET', `/api/review-sessions/${rs.id}/reviews`);
    assert.equal(reviews.at(-1)!.notifications[0].status, 'sent');
    assert.equal(readFileSync(notifyLog(), 'utf8').split('\n').length, linesBefore, 'the hook delivered it, not the terminal');
  });

  it('shows only the changes since the last turn snapshot in last-turn mode', async () => {
    repo.write('src/other.js', 'export const x = 1;\n');
    await waitFor(() => events.some((e) => e.type === 'workspace-changed' && e.paths.includes('src/other.js')));
    const ws = rs.workspaces[0];
    const list = await call<FileListResponse>('GET', `/api/review-sessions/${rs.id}/workspaces/${ws.id}/files?mode=last-turn`);
    assert.deepEqual(list.files.map((f) => f.path), ['src/other.js']);
  });

  it('keeps state in SQLite across a restart', async () => {
    const reopened = new ReviewService(new Db(path.join(repo.dataDir, 'test.sqlite')), repo.dataDir, () => undefined);
    const comments = await reopened.placedComments(rs.id, 'all', null);
    assert.equal(comments.length, 3);
    assert.ok(existsSync(path.join(repo.dataDir, 'test.sqlite')));
  });

  it('drives the loop through the CLI hooks the way Claude Code and Cursor call them', async () => {
    writeFileSync(path.join(repo.dataDir, 'server.json'), JSON.stringify({ pid: process.pid, port: 0, url: base, startedAt: '' }));
    await call('POST', '/api/feedback', { workspace: repo.dir, agentId: 'agent-1' });
    const claude = (event: string, input: object) => cli(['hook', 'claude', event], { session_id: 'claude-1', cwd: repo.dir, ...input });
    const cursor = (event: string, input: object) =>
      cli(['hook', 'cursor', event], { conversation_id: 'cursor-1', workspace_roots: [repo.dir], ...input });

    assert.match(await claude('SessionStart', {}), /agent-diff feedback --workspace/);
    assert.equal(await claude('UserPromptSubmit', {}), '', 'nothing pending at turn start');
    assert.match(JSON.parse(await cursor('sessionStart', {})).additional_context, /agent-diff/);
    assert.deepEqual(JSON.parse(await cursor('beforeSubmitPrompt', {})), { continue: true });

    await call('POST', `/api/review-sessions/${rs.id}/comments`, { body: 'One more thing.' });
    const review = await call<ReviewInfo>('POST', `/api/review-sessions/${rs.id}/reviews`);
    const statuses = async () => {
      const latest = (await call<ReviewInfo[]>('GET', `/api/review-sessions/${rs.id}/reviews`)).find((r) => r.id === review.id)!;
      return Object.fromEntries(latest.notifications.map((n) => [n.agentId, n.status]));
    };
    const before = await statuses();
    assert.equal(before['claude-1'], 'pull', 'hook-only agents wait for their next hook');
    assert.equal(before['cursor-1'], 'pull');

    const stop = JSON.parse(await claude('Stop', { stop_hook_active: false }));
    assert.equal((await statuses())['claude-1'], 'sent');
    assert.equal(stop.decision, 'block');
    assert.match(stop.reason, /review feedback is ready/);
    assert.equal(await claude('Stop', { stop_hook_active: true }), '', "a stop hook that's already continuing doesn't block again");
    assert.match(JSON.parse(await cursor('stop', { status: 'completed', loop_count: 0 })).followup_message, /review feedback is ready/);

    assert.match(await cli(['feedback', '--workspace', repo.dir], {}), /\[1\] Overall comment\s+One more thing\./);
    assert.deepEqual(JSON.parse(await cursor('stop', { status: 'completed', loop_count: 0 })), {}, 'fetched feedback is not offered again');
  });
});

/** Runs bin/agent-diff asynchronously so the in-process server can answer it. */
function cli(args: string[], input: object): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(path.join(prototypeDir, 'bin', 'agent-diff'), args, {
      env: { ...process.env, AGENT_DIFF_DATA_DIR: repo.dataDir, AGENT_DIFF_NOTIFY: 'hook', AGENT_DIFF_NODE: process.execPath },
      encoding: 'utf8',
    }, (error, stdout, stderr) => (error ? reject(new Error(`${error.message}\n${stderr}`)) : resolve(stdout)));
    child.stdin!.end(JSON.stringify(input));
  });
}
