// Prototype review server for the "print mode with --resume" option.
//
// POST /send   {agent, conversation, text, cwd?, callback?, args?}
//   Starts `claude -p --resume <conversation> ...` or
//   `cursor-agent -p --resume <conversation> ...` with the message as the
//   prompt, and reads the reply from the process's stream-json output.
// POST /reply  {id, text}
//   Optional callback the agent calls with curl, tied to the message by its ID.
// GET  /messages
//   Everything sent so far, with timings and replies.
//
// Every event is logged to stdout as one JSON line.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import http from 'node:http';

const PORT = Number(process.env.PORT ?? 47106);
const messages = new Map();

function log(event, fields = {}) {
  console.log(
    JSON.stringify({ t: new Date().toISOString(), event, ...fields }),
  );
}

// The parent agent session's variables would make the child think it's nested.
function cleanEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      key === 'CLAUDECODE' ||
      key.startsWith('CLAUDE_CODE_') ||
      key === 'CLAUDE_PID' ||
      key === 'AI_AGENT'
    ) {
      delete env[key];
    }
  }
  return env;
}

function buildPrompt(id, text, callback) {
  let prompt = `[agent-diff message ${id}]\n${text}`;
  if (callback) {
    prompt +=
      `\n\nWhen you have your answer, send it back by running exactly one command:\n` +
      `curl -s -X POST http://127.0.0.1:${PORT}/reply -H 'content-type: application/json' ` +
      `-d '{"id":"${id}","text":"<your answer>"}'`;
  }
  return prompt;
}

function command(agent, conversation, prompt, extraArgs) {
  if (agent === 'claude') {
    return [
      'claude',
      [
        '-p',
        '--resume',
        conversation,
        '--output-format',
        'stream-json',
        '--verbose',
        ...extraArgs,
        '--',
        prompt,
      ],
    ];
  }
  if (agent === 'cursor') {
    return [
      'cursor-agent',
      [
        '-p',
        '--resume',
        conversation,
        '--output-format',
        'stream-json',
        ...extraArgs,
        '--',
        prompt,
      ],
    ];
  }
  throw new Error(`unknown agent ${agent}`);
}

function send({ agent, conversation, text, cwd, callback = false, args = [] }) {
  const id = randomUUID();
  const prompt = buildPrompt(id, text, callback);
  const [bin, argv] = command(agent, conversation, prompt, args);
  const sentAt = Date.now();
  const msg = {
    id,
    agent,
    conversation,
    text,
    sentAt,
    events: [],
    reply: null,
    callbackReply: null,
    exitCode: null,
  };
  messages.set(id, msg);
  const since = () => Date.now() - sentAt;
  log('send', { id, agent, conversation, cwd, args });

  const child = spawn(bin, argv, {
    cwd: cwd ?? process.cwd(),
    env: cleanEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let buf = '';
  let firstEvent = true;
  let firstAssistant = true;
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        log('stdout', { id, ms: since(), line: line.slice(0, 200) });
        continue;
      }
      if (firstEvent) {
        firstEvent = false;
        log('first-event', {
          id,
          ms: since(),
          type: ev.type,
          subtype: ev.subtype,
        });
      }
      if (ev.type === 'system' && ev.subtype === 'init') {
        log('init', {
          id,
          ms: since(),
          session_id: ev.session_id,
          model: ev.model,
          permissionMode: ev.permissionMode,
        });
      } else if (ev.type === 'assistant') {
        const blocks = ev.message?.content ?? [];
        for (const b of blocks) {
          if (b.type === 'text' && firstAssistant) {
            firstAssistant = false;
            log('first-assistant-text', { id, ms: since() });
          }
          if (b.type === 'tool_use')
            log('tool-use', {
              id,
              ms: since(),
              name: b.name,
              input: JSON.stringify(b.input).slice(0, 200),
            });
        }
      } else if (ev.type === 'tool_call') {
        log('tool-call', {
          id,
          ms: since(),
          subtype: ev.subtype,
          call: JSON.stringify(ev.tool_call ?? {}).slice(0, 200),
        });
      } else if (ev.type === 'system' && ev.subtype === 'permission_denied') {
        log('permission-denied', {
          id,
          ms: since(),
          ev: JSON.stringify(ev).slice(0, 300),
        });
      } else if (ev.type === 'result') {
        msg.reply = ev.result;
        log('reply-from-output', {
          id,
          ms: since(),
          session_id: ev.session_id,
          is_error: ev.is_error,
          subtype: ev.subtype,
          duration_ms: ev.duration_ms,
          permission_denials: ev.permission_denials,
          result: String(ev.result ?? '').slice(0, 500),
        });
      }
    }
  });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  child.on('close', (code) => {
    msg.exitCode = code;
    log('exit', { id, ms: since(), code, stderr: stderr.trim().slice(0, 500) });
  });
  child.on('error', (err) => log('spawn-error', { id, error: String(err) }));
  return msg;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const reply = (status, obj) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  try {
    if (req.method === 'POST' && req.url === '/send') {
      const msg = send(await readJson(req));
      return reply(202, { id: msg.id });
    }
    if (req.method === 'POST' && req.url === '/reply') {
      const body = await readJson(req);
      const msg = messages.get(body.id);
      if (!msg) {
        log('reply-unknown-id', { id: body.id });
        return reply(404, { error: 'unknown message id' });
      }
      msg.callbackReply = body.text;
      log('reply-from-callback', {
        id: body.id,
        ms: Date.now() - msg.sentAt,
        text: String(body.text).slice(0, 500),
      });
      return reply(200, { ok: true });
    }
    if (req.method === 'GET' && req.url === '/messages') {
      return reply(200, [...messages.values()]);
    }
    reply(404, { error: 'not found' });
  } catch (err) {
    reply(400, { error: String(err) });
  }
});

server.listen(PORT, '127.0.0.1', () => log('listening', { port: PORT }));
