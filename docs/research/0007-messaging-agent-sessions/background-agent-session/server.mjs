// Prototype review server: sends a message with an ID into a running Claude
// Code background agent session with `claude --resume <session> "<prompt>"`,
// run in a pseudo-terminal made by `script`, and logs the agent's reply.
//
//   node server.mjs
//   curl -s -X POST localhost:47107/send -d '{"session":"<id>","text":"..."}'
//   curl -s localhost:47107/agents
//
// The agent replies with `node reply.mjs <message-id> <text>`, which POSTs to
// /reply.

import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

const PORT = Number(process.env.PORT ?? 47107);
const HERE = path.dirname(new URL(import.meta.url).pathname);
const messages = new Map();

const log = (...args) => console.log(new Date().toISOString(), ...args);

// A clean environment for `claude`, so it doesn't see this process as a
// parent agent session.
function cleanEnv(extra = {}) {
  const env = {
    HOME: process.env.HOME,
    PATH: process.env.PATH,
    TERM: 'xterm-256color',
    LANG: 'C.UTF-8',
    ...extra,
  };
  return env;
}

function listAgents() {
  return new Promise((resolve, reject) => {
    execFile(
      'claude',
      ['agents', '--json', '--all'],
      { env: cleanEnv() },
      (err, stdout) => (err ? reject(err) : resolve(JSON.parse(stdout))),
    );
  });
}

// Finds the full session UUID for a short ID, session UUID or name.
async function resolveSession(ref) {
  const agents = await listAgents();
  const a = agents.find(
    (x) => x.id === ref || x.sessionId === ref || x.name === ref,
  );
  if (!a) throw new Error(`no agent session matches ${ref}`);
  if (!a.sessionId) throw new Error(`agent session ${ref} has no sessionId`);
  return a;
}

function buildPrompt(id, text) {
  return (
    `[agent-diff review server, message ${id}] ${text}\n` +
    `When you have an answer, reply by running exactly: ` +
    `node reply.mjs ${id} "<your answer>"`
  );
}

// Runs `claude --resume <sessionId> <prompt>` in a pty. `claude` needs a TTY
// on stdin and stdout, or it sends nothing. After it prints the result line,
// the attach that follows is ended by killing the pty.
function sendViaResume(sessionId, prompt) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(
      'script',
      [
        '-q',
        '-e',
        '-c',
        'exec claude --resume "$AD_SID" "$AD_PROMPT"',
        '/dev/null',
      ],
      {
        env: cleanEnv({
          AD_SID: sessionId,
          AD_PROMPT: prompt,
          COLUMNS: '120',
          LINES: '40',
        }),
        cwd: HERE,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    let out = '';
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      // Detach: closing the pty sends SIGHUP to the attached client. The
      // background session keeps running.
      child.kill('SIGHUP');
      setTimeout(() => child.kill('SIGKILL'), 2000);
      resolve({
        ...result,
        ms: Date.now() - t0,
        output: plain(out).slice(-600),
      });
    };
    const onData = (d) => {
      out += d.toString();
      const p = plain(out);
      if (/Sent your prompt to the background session/.test(p))
        finish({ sent: true });
      else if (/Your prompt was not sent/.test(p)) finish({ sent: false });
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => finish({ sent: false, exitCode: code }));
    const timer = setTimeout(
      () => finish({ sent: false, timeout: true }),
      30000,
    );
  });
}

// Strips ANSI escape sequences.
function plain(s) {
  return s
    .replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '')
    .replace(/\x1b[()][0-9A-Za-z]/g, '')
    .replace(/\r/g, '');
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => resolve(b));
  });
}

const server = http.createServer(async (req, res) => {
  const reply = (code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj, null, 2) + '\n');
  };
  try {
    if (req.method === 'GET' && req.url === '/agents') {
      return reply(200, await listAgents());
    }
    if (req.method === 'POST' && req.url === '/send') {
      const { session, text } = JSON.parse(await readBody(req));
      const agent = await resolveSession(session);
      const id = 'm' + randomBytes(3).toString('hex');
      const sentAt = Date.now();
      messages.set(id, { session: agent.sessionId, text, sentAt });
      log(
        `SEND ${id} to ${agent.id ?? agent.sessionId} (state=${agent.state} status=${agent.status} waitingFor=${agent.waitingFor ?? '-'}): ${text}`,
      );
      const r = await sendViaResume(agent.sessionId, buildPrompt(id, text));
      log(
        `SEND-RESULT ${id} sent=${r.sent} after ${r.ms}ms${r.exitCode !== undefined ? ` exit=${r.exitCode}` : ''}${r.timeout ? ' timeout' : ''}`,
      );
      if (!r.sent) log(`SEND-OUTPUT ${id}: ${JSON.stringify(r.output)}`);
      return reply(200, { id, ...r });
    }
    if (req.method === 'POST' && req.url === '/reply') {
      const { id, text } = JSON.parse(await readBody(req));
      const m = messages.get(id);
      if (!m) {
        log(`REPLY for unknown message ${id}: ${text}`);
        return reply(404, { error: 'unknown message id' });
      }
      log(`REPLY ${id} after ${Date.now() - m.sentAt}ms: ${text}`);
      m.reply = text;
      return reply(200, { ok: true });
    }
    reply(404, { error: 'not found' });
  } catch (e) {
    log('ERROR', e.message);
    reply(500, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => log(`listening on 127.0.0.1:${PORT}`));
