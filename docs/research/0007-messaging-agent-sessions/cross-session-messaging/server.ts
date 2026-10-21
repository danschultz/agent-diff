// Prototype review server for Claude Code cross-session messaging.
//
// - Sends a message with an ID to a Claude Code agent session's inbox socket.
// - Binds its own inbox socket in the same directory, and names it as the
//   reply address, so the agent can answer with its SendMessage tool.
// - Also takes replies over HTTP (POST /reply), for an agent that answers with
//   curl instead.
// - Logs every frame it receives, tied to the message it answers.
//
// Run with `node server.ts`. No dependencies beyond Node's standard library.

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createConnection, createServer as createNetServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const PORT = Number(process.env.PORT ?? 47104);
// Only agent sessions whose working directory starts with this are addressed.
const AGENT_CWD = process.env.AGENT_CWD ?? process.cwd();
const INBOX_NAME = process.env.INBOX_NAME ?? `agent-diff-${PORT}.sock`;

type Sent = {
  id: string;
  frameMsgId: string;
  socket: string;
  sentAt: number;
  text: string;
  receipts: { status: string; at: number }[];
  replies: { via: string; text: string; at: number }[];
};

const sent = new Map<string, Sent>();
const byFrameMsgId = new Map<string, Sent>();
let inboxPath: string | undefined;

function log(event: string, data: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ t: new Date().toISOString(), event, ...data }));
}

// Lists Claude Code agent sessions on this machine, from `claude agents
// --json` (documented), adding the inbox socket path from the session
// registry file (~/.claude/sessions/<pid>.json, not documented).
function listAgents(): Record<string, unknown>[] {
  const out = execFileSync('claude', ['agents', '--json'], {
    encoding: 'utf8',
  });
  const agents = JSON.parse(out) as Record<string, unknown>[];
  return agents
    .filter((a) => typeof a.cwd === 'string' && a.cwd.startsWith(AGENT_CWD))
    .map((a) => {
      let messagingSocketPath: string | undefined;
      try {
        const reg = JSON.parse(
          readFileSync(
            join(homedir(), '.claude', 'sessions', `${a.pid}.json`),
            'utf8',
          ),
        ) as { messagingSocketPath?: string };
        messagingSocketPath = reg.messagingSocketPath;
      } catch {}
      return { ...a, messagingSocketPath };
    });
}

function findSocket(pid: number | undefined): string {
  const agents = listAgents();
  const agent =
    pid === undefined ? agents.at(-1) : agents.find((a) => a.pid === pid);
  if (!agent) throw new Error(`no agent session under ${AGENT_CWD}`);
  if (typeof agent.messagingSocketPath !== 'string')
    throw new Error(`agent session ${agent.pid} has no inbox socket`);
  return agent.messagingSocketPath;
}

// Binds the review server's inbox in the same directory as the agent
// session's socket, so the agent session accepts it as a reply address.
function ensureInbox(agentSocket: string): string {
  const path = join(dirname(agentSocket), INBOX_NAME);
  if (inboxPath === path) return path;
  if (existsSync(path)) unlinkSync(path);
  const server = createNetServer((conn) => {
    let buf = '';
    conn.setEncoding('utf8');
    conn.on('data', (chunk: string) => {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf('\n')) !== -1) {
        handleInboxLine(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    });
    conn.on('end', () => {
      if (buf.trim()) handleInboxLine(buf);
      buf = '';
    });
    conn.on('error', () => {});
  });
  // Only this OS user may write replies to it.
  server.listen(path, () => chmodSync(path, 0o600));
  inboxPath = path;
  log('inbox-bound', { path });
  return path;
}

function handleInboxLine(line: string): void {
  if (!line.trim()) return;
  let frame: Record<string, any>;
  try {
    frame = JSON.parse(line);
  } catch {
    log('inbox-unparsed', { line });
    return;
  }
  if (frame.type === 'control' && frame.action === 'peer_message_status') {
    const s = byFrameMsgId.get(frame.orig_msg_id);
    s?.receipts.push({ status: frame.status, at: Date.now() });
    log('receipt', {
      id: s?.id,
      status: frame.status,
      ms: s ? Date.now() - s.sentAt : undefined,
      frame,
    });
    return;
  }
  if (frame.type === 'user') {
    const content: string = frame.message?.content ?? '';
    const m = /\b(ad-[0-9a-f]{8})\b/.exec(content);
    const s = m ? sent.get(m[1]) : undefined;
    s?.replies.push({ via: 'socket', text: content, at: Date.now() });
    log('reply', {
      via: 'socket',
      id: s?.id ?? null,
      ms: s ? Date.now() - s.sentAt : undefined,
      frame,
    });
    return;
  }
  log('inbox-frame', { frame });
}

type SendOptions = {
  pid?: number;
  socket?: string;
  text: string;
  priority?: 'now' | 'next' | 'later';
  // Wrap the text in a <cross-session-message> tag, the way a Claude Code
  // session wraps what its SendMessage tool sends.
  wrap?: boolean;
  // Claimed permission-mode class: "bypass" or "prompting".
  fromMode?: string;
  // Send `{"type":"auth","token":...}` first.
  token?: string;
  // Leave out `from`, so the agent session has no reply address.
  noFrom?: boolean;
  // Leave out the instructions on how to answer.
  bare?: boolean;
  // The agent session's ID. The agent session drops the frame if it doesn't
  // match, which guards against a reused PID.
  sessionId?: string;
};

function send(opts: SendOptions): Promise<Sent> {
  const socket = opts.socket ?? findSocket(opts.pid);
  const inbox = ensureInbox(socket);
  const id = `ad-${randomUUID().slice(0, 8)}`;
  const frameMsgId = randomUUID();
  const from = `uds:${inbox}`;
  const body = opts.bare
    ? `[${id}] ${opts.text}`
    : `[${id}] ${opts.text}\n\n` +
      `(From the agent-diff review server. Answer with your SendMessage tool, ` +
      `to "${from}", and start the answer with "${id}".)`;
  const attrs =
    ` from="${from}" from-name="agent-diff"` +
    (opts.fromMode ? ` from-mode="${opts.fromMode}"` : '');
  const content = opts.wrap
    ? `<cross-session-message${attrs}>\n${body}\n</cross-session-message>`
    : body;
  const frame = {
    msgV: 1,
    msg_id: frameMsgId,
    type: 'user',
    message: { role: 'user', content },
    priority: opts.priority ?? 'next',
    ...(opts.noFrom ? {} : { from }),
    ...(opts.sessionId ? { session_id: opts.sessionId } : {}),
  };
  const s: Sent = {
    id,
    frameMsgId,
    socket,
    sentAt: Date.now(),
    text: opts.text,
    receipts: [],
    replies: [],
  };
  sent.set(id, s);
  byFrameMsgId.set(frameMsgId, s);
  return new Promise((resolve, reject) => {
    const conn = createConnection(socket, () => {
      if (opts.token)
        conn.write(JSON.stringify({ type: 'auth', token: opts.token }) + '\n');
      conn.end(JSON.stringify(frame) + '\n');
      log('sent', { id, socket, frame });
      resolve(s);
    });
    conn.on('error', (err) => {
      log('send-error', { id, socket, error: String(err) });
      reject(err);
    });
  });
}

function readJson(req: import('node:http').IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      try {
        resolve(b ? JSON.parse(b) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

const http = createHttpServer(async (req, res) => {
  const reply = (code: number, data: unknown) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(data, null, 2) + '\n');
  };
  try {
    if (req.method === 'GET' && req.url === '/agents')
      return reply(200, listAgents());
    if (req.method === 'GET' && req.url === '/messages')
      return reply(200, [...sent.values()]);
    if (req.method === 'POST' && req.url === '/send') {
      const s = await send(await readJson(req));
      return reply(200, { id: s.id, socket: s.socket });
    }
    // Reply path for an agent that answers with curl.
    if (req.method === 'POST' && req.url === '/reply') {
      const body = await readJson(req);
      const s = sent.get(body.id);
      s?.replies.push({ via: 'http', text: body.text, at: Date.now() });
      log('reply', {
        via: 'http',
        id: s?.id ?? null,
        ms: s ? Date.now() - s.sentAt : undefined,
        body,
      });
      return reply(s ? 200 : 404, { ok: !!s });
    }
    reply(404, { error: 'not found' });
  } catch (e) {
    reply(500, { error: String(e) });
  }
});

http.listen(PORT, '127.0.0.1', () =>
  log('listening', { port: PORT, agentCwd: AGENT_CWD }),
);

function cleanup(): void {
  if (inboxPath && existsSync(inboxPath)) unlinkSync(inboxPath);
  process.exit(0);
}
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
