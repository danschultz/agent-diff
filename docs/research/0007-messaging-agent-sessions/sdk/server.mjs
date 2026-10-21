// Prototype: the review server owns Claude Code agent sessions and pushes
// messages into them, either through the Agent SDK's streaming input ("sdk")
// or by running `claude -p --input-format stream-json` itself ("cli").
// Every message gets an ID. Replies are tied back to it by the `reply` tool
// (sdk only), by `user_message_uuid` on assistant frames, and by the turn's
// result. Everything is logged to stdout as JSON lines with timestamps.

import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import {
  createSdkMcpServer,
  query,
  tool,
} from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

const PORT = Number(process.env.PORT ?? 47108);
const TOKEN = process.env.AD_TOKEN ?? randomBytes(16).toString('hex');

const sessions = new Map();
const messages = new Map();

function log(event, data = {}) {
  console.log(JSON.stringify({ t: new Date().toISOString(), event, ...data }));
}

// An async iterable the SDK reads user messages from. push() can be called at
// any time, whether the agent session is idle or in the middle of a turn.
class Inbox {
  #items = [];
  #waiters = [];
  #closed = false;
  push(item) {
    const waiter = this.#waiters.shift();
    if (waiter) waiter({ value: item, done: false });
    else this.#items.push(item);
  }
  close() {
    this.#closed = true;
    for (const w of this.#waiters.splice(0))
      w({ value: undefined, done: true });
  }
  [Symbol.asyncIterator]() {
    return {
      next: () => {
        if (this.#items.length)
          return Promise.resolve({ value: this.#items.shift(), done: false });
        if (this.#closed)
          return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.#waiters.push(resolve));
      },
    };
  }
}

// The agent session gets only what it needs, not this process's environment,
// so a parent agent's CLAUDECODE / CLAUDE_CODE_* variables don't leak in.
// CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS makes the CLI report idle / running /
// requires_action as system messages.
function agentEnv(inherit) {
  return { ...baseEnv(inherit), CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1' };
}

function baseEnv(inherit) {
  if (inherit) return { ...process.env };
  return {
    HOME: process.env.HOME,
    PATH: process.env.PATH,
    TERM: 'xterm-256color',
    LANG: 'C.UTF-8',
  };
}

function since(ms) {
  return ms === undefined ? undefined : Date.now() - ms;
}

function recordReply(session, messageId, via, text) {
  const m = messages.get(messageId);
  if (!m || m.sessionId !== session.id) {
    log('reply.unknown_message', { session: session.id, messageId, via, text });
    return false;
  }
  m.replies.push({ via, text, at: new Date().toISOString() });
  log('reply', {
    session: session.id,
    messageId,
    via,
    msSinceSend: since(m.sentAtMs),
    text,
  });
  return true;
}

function wrap(session, id, text) {
  const how =
    session.kind === 'sdk'
      ? `Answer by calling the mcp__review__reply tool with message_id "${id}".`
      : `Answer in plain text.`;
  return `[agent-diff review server, message ${id}]\n${text}\n\n${how}`;
}

function handleOutput(session, m) {
  if (m.type === 'system' && m.subtype === 'init') {
    session.claudeSessionId = m.session_id;
    log('agent.init', {
      session: session.id,
      claudeSessionId: m.session_id,
      model: m.model,
      cwd: m.cwd,
      permissionMode: m.permissionMode,
    });
  } else if (m.type === 'system' && m.subtype === 'session_state_changed') {
    session.state = m.state;
    log('agent.state', { session: session.id, state: m.state });
  } else if (m.type === 'user' && m.isReplay) {
    // The CLI echoes a pushed message when it takes it into the conversation.
    const msg = m.uuid && messages.get(m.uuid);
    if (msg) {
      msg.consumedAtMs ??= Date.now();
      log('message.consumed', {
        session: session.id,
        messageId: m.uuid,
        msSinceSend: since(msg.sentAtMs),
      });
    }
  } else if (m.type === 'assistant') {
    const id = m.user_message_uuid;
    if (id && messages.has(id)) {
      session.currentMessageId = id;
      const msg = messages.get(id);
      if (msg.firstFrameAtMs === undefined) {
        msg.firstFrameAtMs = Date.now();
        log('turn.first_frame', {
          session: session.id,
          messageId: id,
          msSinceSend: since(msg.sentAtMs),
        });
      }
    }
    for (const block of m.message?.content ?? []) {
      if (block.type === 'text')
        log('agent.text', {
          session: session.id,
          answering: session.currentMessageId,
          text: block.text,
        });
      if (block.type === 'tool_use')
        log('agent.tool_use', {
          session: session.id,
          answering: session.currentMessageId,
          tool: block.name,
          input: block.input,
        });
    }
  } else if (m.type === 'result') {
    const id = session.currentMessageId;
    log('turn.result', {
      session: session.id,
      answering: id,
      subtype: m.subtype,
      result: m.result,
      durationMs: m.duration_ms,
      costUsd: m.total_cost_usd,
    });
    if (id && session.kind === 'cli' && m.result)
      recordReply(session, id, 'result', m.result);
  } else if (m.type === 'system' && m.subtype === 'task_started') {
    log('agent.subagent_started', {
      session: session.id,
      taskId: m.task_id,
      description: m.description,
    });
  }
}

// Holds a permission prompt until someone answers it over HTTP.
function holdPermission(session, requestId, toolName, input, signal) {
  return new Promise((resolve) => {
    session.pending.set(requestId, { toolName, input, resolve });
    log('permission.requested', {
      session: session.id,
      requestId,
      toolName,
      input,
    });
    signal?.addEventListener('abort', () => {
      session.pending.delete(requestId);
      log('permission.aborted', { session: session.id, requestId });
      resolve({ behavior: 'deny', message: 'aborted' });
    });
  });
}

function startSdkSession(opts) {
  const session = {
    id: randomUUID().slice(0, 8),
    kind: 'sdk',
    state: 'starting',
    pending: new Map(),
    inbox: new Inbox(),
  };
  const review = createSdkMcpServer({
    name: 'review',
    tools: [
      tool(
        'reply',
        'Send a reply to the agent-diff review server, for the message with the given message_id.',
        { message_id: z.string(), text: z.string() },
        async ({ message_id, text }) => {
          const ok = recordReply(session, message_id, 'tool', text);
          return {
            content: [
              { type: 'text', text: ok ? 'Delivered.' : 'Unknown message_id.' },
            ],
          };
        },
      ),
    ],
  });
  session.query = query({
    prompt: session.inbox,
    options: {
      cwd: opts.cwd,
      model: opts.model,
      permissionMode: opts.permissionMode ?? 'default',
      settingSources: opts.settingSources ?? ['project'],
      mcpServers: { review },
      allowedTools: ['mcp__review__reply', ...(opts.allowedTools ?? [])],
      env: agentEnv(opts.inheritEnv),
      resume: opts.resume,
      // Echo each pushed message when the CLI takes it into the conversation.
      extraArgs: { 'replay-user-messages': null },
      canUseTool: (toolName, input, { signal, requestId }) =>
        holdPermission(session, requestId, toolName, input, signal),
      stderr: (line) => log('agent.stderr', { session: session.id, line }),
    },
  });
  session.send = (msg) => session.inbox.push(msg);
  session.close = () => {
    session.inbox.close();
    session.query.close();
  };
  (async () => {
    try {
      for await (const m of session.query) handleOutput(session, m);
      log('agent.exited', { session: session.id });
    } catch (err) {
      log('agent.error', {
        session: session.id,
        error: String(err?.message ?? err),
      });
    }
    session.state = 'exited';
  })();
  return session;
}

// The same thing without the SDK: the review server runs the CLI and speaks
// its stream-json protocol on stdin/stdout.
function startCliSession(opts) {
  const session = {
    id: randomUUID().slice(0, 8),
    kind: 'cli',
    state: 'starting',
    pending: new Map(),
  };
  const args = [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--replay-user-messages',
    '--permission-prompt-tool',
    'stdio',
    '--setting-sources',
    (opts.settingSources ?? ['project']).join(','),
    '--permission-mode',
    opts.permissionMode ?? 'default',
  ];
  if (opts.model) args.push('--model', opts.model);
  if (opts.allowedTools?.length)
    args.push('--allowedTools', opts.allowedTools.join(','));
  if (opts.resume) args.push('--resume', opts.resume);
  const child = spawn(opts.claudePath ?? 'claude', args, {
    cwd: opts.cwd,
    env: agentEnv(opts.inheritEnv),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  session.child = child;
  const write = (obj) => child.stdin.write(JSON.stringify(obj) + '\n');
  session.send = (msg) => write(msg);
  session.close = () => child.stdin.end();
  session.answer = (requestId, response) =>
    write({
      type: 'control_response',
      response: { subtype: 'success', request_id: requestId, response },
    });
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      log('agent.stdout', { session: session.id, line });
      return;
    }
    if (m.type === 'control_request' && m.request?.subtype === 'can_use_tool') {
      const r = m.request;
      holdPermission(session, m.request_id, r.tool_name, r.input).then((res) =>
        session.answer(
          m.request_id,
          res.behavior === 'allow'
            ? { behavior: 'allow', updatedInput: r.input }
            : res,
        ),
      );
      return;
    }
    handleOutput(session, m);
  });
  readline
    .createInterface({ input: child.stderr })
    .on('line', (line) => log('agent.stderr', { session: session.id, line }));
  child.on('exit', (code, signal) => {
    session.state = 'exited';
    log('agent.exited', { session: session.id, code, signal });
  });
  return session;
}

function sendMessage(session, text, priority) {
  const id = randomUUID();
  messages.set(id, {
    sessionId: session.id,
    text,
    sentAtMs: Date.now(),
    replies: [],
  });
  const msg = {
    type: 'user',
    uuid: id,
    message: { role: 'user', content: wrap(session, id, text) },
    parent_tool_use_id: null,
  };
  if (priority) msg.priority = priority;
  log('message.sent', {
    session: session.id,
    messageId: id,
    agentState: session.state,
    priority,
    text,
  });
  if (session.state === 'exited')
    log('message.to_exited_session', { session: session.id, messageId: id });
  session.send(msg);
  return id;
}

function answerPermission(session, requestId, allow, message) {
  const p = session.pending.get(requestId);
  if (!p) return false;
  session.pending.delete(requestId);
  log('permission.answered', { session: session.id, requestId, allow });
  p.resolve(
    allow
      ? { behavior: 'allow', updatedInput: p.input }
      : {
          behavior: 'deny',
          message: message ?? 'Denied by the review server.',
        },
  );
  return true;
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

function view(s) {
  return {
    id: s.id,
    kind: s.kind,
    state: s.state,
    claudeSessionId: s.claudeSessionId,
    pendingPermissions: [...s.pending].map(([requestId, p]) => ({
      requestId,
      toolName: p.toolName,
      input: p.input,
    })),
  };
}

const server = http.createServer(async (req, res) => {
  const reply = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.headers.authorization !== `Bearer ${TOKEN}`)
    return reply(401, { error: 'unauthorized' });
  const parts = new URL(req.url, 'http://x').pathname
    .split('/')
    .filter(Boolean);
  try {
    if (
      req.method === 'POST' &&
      parts.length === 1 &&
      parts[0] === 'sessions'
    ) {
      const opts = await readJson(req);
      const s = (opts.kind === 'cli' ? startCliSession : startSdkSession)(opts);
      sessions.set(s.id, s);
      log('session.started', {
        session: s.id,
        kind: s.kind,
        cwd: opts.cwd,
        model: opts.model,
      });
      return reply(201, view(s));
    }
    if (req.method === 'GET' && parts.length === 1 && parts[0] === 'sessions')
      return reply(200, [...sessions.values()].map(view));
    if (parts[0] === 'messages' && parts[1] && req.method === 'GET') {
      const m = messages.get(parts[1]);
      return m ? reply(200, m) : reply(404, { error: 'no such message' });
    }
    const s = parts[0] === 'sessions' && sessions.get(parts[1]);
    if (!s) return reply(404, { error: 'no such session' });
    if (req.method === 'GET' && parts.length === 2) return reply(200, view(s));
    if (req.method === 'POST' && parts[2] === 'messages') {
      const { text, priority } = await readJson(req);
      return reply(202, { messageId: sendMessage(s, text, priority) });
    }
    if (req.method === 'POST' && parts[2] === 'permissions' && parts[3]) {
      const { allow, message } = await readJson(req);
      return answerPermission(s, parts[3], allow, message)
        ? reply(200, { ok: true })
        : reply(404, { error: 'no such request' });
    }
    if (req.method === 'POST' && parts[2] === 'interrupt') {
      if (s.kind !== 'sdk') return reply(400, { error: 'sdk sessions only' });
      return reply(200, (await s.query.interrupt()) ?? {});
    }
    if (req.method === 'DELETE' && parts.length === 2) {
      s.close();
      return reply(200, { ok: true });
    }
    reply(404, { error: 'not found' });
  } catch (err) {
    reply(500, { error: String(err?.message ?? err) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  log('server.listening', { url: `http://127.0.0.1:${PORT}` });
  if (!process.env.AD_TOKEN) console.error(`token: ${TOKEN}`);
});
