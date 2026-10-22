// Prototype review server that talks to the Cursor CLI over the Agent Client
// Protocol (ACP). It spawns `cursor-agent acp`, acts as the ACP client, and
// exposes a small HTTP API on 127.0.0.1 so messages with IDs can be sent to
// agent sessions and their replies read back.
//
// It also serves a tiny MCP server over HTTP at /mcp, which is passed to the
// agent in `session/new` and `session/load`, so the agent can send a message
// back with a `reply` tool that names the message ID.
//
// Usage: node server.mjs [workspace-dir]
// Env: PORT (default 47109), AGENT_BIN (default cursor-agent),
//      PERMISSIONS=ask|allow|reject (default ask), LOG_FILE (optional).

import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';

const PORT = Number(process.env.PORT ?? 47109);
const AGENT_BIN = process.env.AGENT_BIN ?? 'cursor-agent';
const PERMISSIONS = process.env.PERMISSIONS ?? 'ask';
const LOG_FILE = process.env.LOG_FILE;
const WORKSPACE = resolve(process.argv[2] ?? process.cwd());
const TOKEN = randomBytes(16).toString('hex');
const T0 = Date.now();

function log(event, data = {}) {
  const line = JSON.stringify({
    t: new Date().toISOString(),
    ms: Date.now() - T0,
    event,
    ...data,
  });
  console.log(line);
  if (LOG_FILE) appendFileSync(LOG_FILE, line + '\n');
}

// ---------------------------------------------------------------------------
// ACP client over stdio (newline-delimited JSON-RPC 2.0)

const agent = spawn(AGENT_BIN, ['acp'], {
  cwd: WORKSPACE,
  stdio: ['pipe', 'pipe', 'pipe'],
});
let nextRpcId = 1;
const pendingRpc = new Map(); // our request id -> {resolve, reject, method}
const pendingPermissions = new Map(); // agent request id -> request params
const messages = new Map(); // message id -> message record
const activeBySession = new Map(); // ACP session id -> message id of running turn

agent.on('exit', (code, signal) => {
  log('agent_exit', { code, signal });
  for (const { reject, method } of pendingRpc.values())
    reject(new Error(`agent exited during ${method}`));
  pendingRpc.clear();
});
agent.stderr.on('data', (d) =>
  log('agent_stderr', { text: d.toString().slice(0, 500) }),
);

let buffer = '';
agent.stdout.on('data', (chunk) => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, i).trim();
    buffer = buffer.slice(i + 1);
    if (line) onAgentMessage(JSON.parse(line));
  }
});

function send(obj) {
  agent.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...obj }) + '\n');
}

function request(method, params) {
  const id = nextRpcId++;
  send({ id, method, params });
  return new Promise((resolve, reject) =>
    pendingRpc.set(id, { resolve, reject, method }),
  );
}

function onAgentMessage(msg) {
  if (msg.method === undefined) {
    const p = pendingRpc.get(msg.id);
    if (!p) return log('unexpected_response', { msg });
    pendingRpc.delete(msg.id);
    if (msg.error) p.reject(Object.assign(new Error(msg.error.message), msg));
    else p.resolve(msg.result);
    return;
  }
  if (msg.method === 'session/update') return onSessionUpdate(msg.params);
  if (msg.method === 'session/request_permission')
    return onPermissionRequest(msg);
  if (msg.id !== undefined) {
    // cursor/ask_question, cursor/create_plan, fs/*, terminal/*: not supported.
    log('agent_request_unsupported', {
      method: msg.method,
      params: msg.params,
    });
    send({
      id: msg.id,
      error: { code: -32601, message: `unsupported: ${msg.method}` },
    });
    return;
  }
  log('agent_notification', {
    method: msg.method,
    params: JSON.stringify(msg.params).slice(0, 300),
  });
}

function onSessionUpdate({ sessionId, update }) {
  const kind = update.sessionUpdate;
  if (kind === 'available_commands_update') return;
  const m = messages.get(activeBySession.get(sessionId));
  if (m) {
    m.updates++;
    if (m.firstUpdateMs === undefined) {
      m.firstUpdateMs = Date.now() - m.sentAt;
      log('turn_first_update', { id: m.id, kind, afterMs: m.firstUpdateMs });
    }
    if (kind === 'agent_message_chunk' && update.content?.type === 'text') {
      if (m.firstTextMs === undefined) m.firstTextMs = Date.now() - m.sentAt;
      m.reply += update.content.text;
    }
  }
  if (kind === 'agent_message_chunk' || kind === 'agent_thought_chunk') return;
  log('session_update', {
    sessionId,
    activeMessage: m?.id,
    kind,
    detail: JSON.stringify(update).slice(0, 300),
  });
}

function onPermissionRequest(msg) {
  const { sessionId, toolCall, options } = msg.params;
  log('permission_request', {
    rpcId: msg.id,
    sessionId,
    activeMessage: activeBySession.get(sessionId),
    title: toolCall?.title,
    options: options.map((o) => `${o.optionId}(${o.kind})`),
  });
  if (PERMISSIONS === 'ask') {
    pendingPermissions.set(msg.id, msg.params);
    return;
  }
  const kind = PERMISSIONS === 'allow' ? 'allow_once' : 'reject_once';
  const option = options.find((o) => o.kind === kind) ?? options[0];
  answerPermission(msg.id, { outcome: 'selected', optionId: option.optionId });
}

function answerPermission(rpcId, outcome) {
  pendingPermissions.delete(rpcId);
  send({ id: rpcId, result: { outcome } });
  log('permission_answered', { rpcId, outcome });
}

// ---------------------------------------------------------------------------
// Messages from the review server to an agent session

function framePrompt(id, text) {
  return [
    `[agent-diff message ${id}]`,
    text,
    '',
    `When you're done, call the agent-diff MCP tool \`reply\` with messageId "${id}" and a one-line answer.`,
  ].join('\n');
}

async function sendMessage({ sessionId, text, cancelFirst = false }) {
  const id = `msg-${randomUUID().slice(0, 8)}`;
  const m = {
    id,
    sessionId,
    text,
    sentAt: Date.now(),
    updates: 0,
    reply: '',
    toolReplies: [],
    status: 'sent',
  };
  messages.set(id, m);
  const busyWith = activeBySession.get(sessionId);
  log('message_send', { id, sessionId, busyWith, cancelFirst });
  if (busyWith && cancelFirst) {
    send({ method: 'session/cancel', params: { sessionId } });
    log('cancel_sent', { sessionId, cancelled: busyWith });
  }
  activeBySession.set(sessionId, id);
  request('session/prompt', {
    sessionId,
    prompt: [{ type: 'text', text: framePrompt(id, text) }],
  }).then(
    (result) => {
      m.status = 'done';
      m.stopReason = result?.stopReason;
      m.doneMs = Date.now() - m.sentAt;
      if (activeBySession.get(sessionId) === id)
        activeBySession.delete(sessionId);
      log('turn_end', {
        id,
        stopReason: m.stopReason,
        afterMs: m.doneMs,
        firstTextMs: m.firstTextMs,
        reply: m.reply.slice(0, 300),
      });
    },
    (err) => {
      m.status = 'error';
      m.error = err.error ?? err.message;
      if (activeBySession.get(sessionId) === id)
        activeBySession.delete(sessionId);
      log('turn_error', { id, error: m.error, afterMs: Date.now() - m.sentAt });
    },
  );
  return m;
}

// ---------------------------------------------------------------------------
// Minimal MCP server (streamable HTTP, JSON responses only) with a reply tool

const mcpTools = [
  {
    name: 'reply',
    description:
      'Send a message back to the agent-diff review server, answering the message with the given ID.',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: {
          type: 'string',
          description: 'ID of the message being answered',
        },
        text: { type: 'string' },
      },
      required: ['messageId', 'text'],
    },
  },
];

function handleMcp(rpc) {
  const { id, method, params } = rpc;
  if (id === undefined) return undefined; // notification
  if (method === 'initialize')
    return {
      id,
      result: {
        protocolVersion: params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'agent-diff', version: '0.0.0' },
      },
    };
  if (method === 'tools/list') return { id, result: { tools: mcpTools } };
  if (method === 'tools/call' && params?.name === 'reply') {
    const { messageId, text } = params.arguments ?? {};
    const m = messages.get(messageId);
    log('tool_reply', {
      messageId,
      known: Boolean(m),
      afterMs: m ? Date.now() - m.sentAt : undefined,
      text,
    });
    m?.toolReplies.push({ text, afterMs: Date.now() - m.sentAt });
    return {
      id,
      result: {
        content: [
          {
            type: 'text',
            text: m ? 'Delivered.' : `Unknown message ID ${messageId}.`,
          },
        ],
        isError: !m,
      },
    };
  }
  return { id, error: { code: -32601, message: `unsupported: ${method}` } };
}

function mcpServerConfig() {
  return [
    {
      type: 'http',
      name: 'agent-diff',
      url: `http://127.0.0.1:${PORT}/mcp`,
      headers: [{ name: 'Authorization', value: `Bearer ${TOKEN}` }],
    },
  ];
}

// ---------------------------------------------------------------------------
// HTTP API

async function readJson(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

function reply(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data, null, 2) + '\n');
}

const routes = {
  'POST /sessions': async (body) => {
    const params = {
      cwd: body.cwd ?? WORKSPACE,
      mcpServers: mcpServerConfig(),
    };
    if (body.load) {
      const result = await request('session/load', {
        ...params,
        sessionId: body.load,
      });
      log('session_loaded', { sessionId: body.load });
      return { sessionId: body.load, result };
    }
    const result = await request('session/new', params);
    log('session_new', { sessionId: result.sessionId });
    return { sessionId: result.sessionId, modes: result.modes?.currentModeId };
  },
  'GET /sessions': () => request('session/list', {}),
  'POST /messages': (body) => sendMessage(body),
  'GET /messages': () => [...messages.values()],
  'POST /cancel': (body) => {
    send({ method: 'session/cancel', params: { sessionId: body.sessionId } });
    log('cancel_sent', { sessionId: body.sessionId });
    return { ok: true };
  },
  'GET /permissions': () =>
    [...pendingPermissions].map(([rpcId, p]) => ({ rpcId, ...p })),
  'POST /permissions': (body) => {
    answerPermission(
      body.rpcId,
      body.optionId
        ? { outcome: 'selected', optionId: body.optionId }
        : { outcome: 'cancelled' },
    );
    return { ok: true };
  },
  'POST /raw': (body) => request(body.method, body.params),
};

createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${TOKEN}`)
    return reply(res, 401, { error: 'missing or wrong token' });
  try {
    const body = await readJson(req);
    if (req.url === '/mcp') {
      if (req.method !== 'POST') return reply(res, 405, {});
      const out = handleMcp(body);
      if (!out) {
        res.writeHead(202);
        return res.end();
      }
      return reply(res, 200, { jsonrpc: '2.0', ...out });
    }
    const route = routes[`${req.method} ${req.url.split('?')[0]}`];
    if (!route) return reply(res, 404, { error: 'not found' });
    reply(res, 200, await route(body));
  } catch (err) {
    reply(res, 500, { error: err.error ?? err.message });
  }
}).listen(PORT, '127.0.0.1', async () => {
  const init = await request('initialize', {
    protocolVersion: 1,
    clientCapabilities: {
      fs: { readTextFile: false, writeTextFile: false },
      terminal: false,
    },
    clientInfo: { name: 'agent-diff-acp-prototype', version: '0.0.0' },
  });
  log('initialized', {
    protocolVersion: init.protocolVersion,
    agentCapabilities: init.agentCapabilities,
  });
  log('listening', {
    url: `http://127.0.0.1:${PORT}`,
    tokenFile: 'printed below',
  });
  console.log(`TOKEN=${TOKEN}`);
});
