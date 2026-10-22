// Prototype "review server" that tries to reach an agent session through
// standard MCP server-to-client messages, plus a long-poll tool for comparison.
//
//   node server.mjs --transport=http  --port=47102  # MCP at /mcp, control at /control
//   node server.mjs --transport=stdio --port=47112  # MCP on stdio (spawned by the agent), control on the port
//
// Control API (127.0.0.1 only):
//   POST /control/send  {"kind": "...", "text": "..."}  -> {"id": "m-1", ...}
//   GET  /control/status                                  -> connected MCP sessions
// Every JSON-RPC message in and out, every send and every reply is appended,
// with a timestamp, to the log file in $AD_LOG (default /tmp/ad-mcpnotif-<transport>.log).

import { appendFileSync } from 'node:fs';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  CreateMessageResultSchema,
  ElicitResultSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  SetLevelRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  }),
);
const transportKind = args.transport ?? 'http';
const port = Number(args.port ?? (transportKind === 'http' ? 47102 : 47112));
const logFile = process.env.AD_LOG ?? `/tmp/ad-mcpnotif-${transportKind}.log`;

function log(event, data = {}) {
  const line = JSON.stringify({
    t: new Date().toISOString(),
    pid: process.pid,
    event,
    ...data,
  });
  appendFileSync(logFile, line + '\n');
  if (transportKind === 'http') console.log(line);
}

process.on('uncaughtException', (e) => {
  log('uncaughtException', { error: String(e?.stack ?? e) });
});
process.on('unhandledRejection', (e) => {
  log('unhandledRejection', { error: String(e?.stack ?? e) });
});
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(sig, () => {
    log('signal', { sig });
    process.exit(0);
  });
}
process.on('exit', (code) => log('exit', { code }));

// ---- shared state ------------------------------------------------------------

let nextId = 1;
const sessions = new Map(); // key -> { server, transport, key, subscriptions:Set, activeTasks:Set }
const pollQueue = []; // messages waiting for wait_for_message
const pollWaiters = []; // resolve functions of blocked wait_for_message calls
const inbox = []; // every message, for resources and check_inbox
const dynamicTools = new Map(); // name -> tool
const dynamicPrompts = new Map(); // name -> prompt
const dynamicResources = new Map(); // uri -> { resource, text }
const pendingProgress = []; // messages to emit as notifications/progress during slow_task

const baseTools = [
  {
    name: 'reply',
    description:
      'Reply to a message from the review server. Pass the message_id of the message you are answering.',
    inputSchema: {
      type: 'object',
      properties: { message_id: { type: 'string' }, text: { type: 'string' } },
      required: ['message_id', 'text'],
    },
  },
  {
    name: 'wait_for_message',
    description:
      'Block until the review server has a message for you, then return it. Returns "no message" after timeout_seconds.',
    inputSchema: {
      type: 'object',
      properties: {
        timeout_seconds: { type: 'number', description: 'Default 3600.' },
        heartbeat_seconds: {
          type: 'number',
          description:
            'Send a progress notification this often while waiting (0 = never). Default 0.',
        },
      },
    },
  },
  {
    name: 'slow_task',
    description:
      'A long-running task. Sends progress notifications while it runs.',
    inputSchema: {
      type: 'object',
      properties: { seconds: { type: 'number' } },
      required: ['seconds'],
    },
  },
  {
    name: 'check_inbox',
    description: 'List every message the review server has sent so far.',
    inputSchema: { type: 'object', properties: {} },
  },
];

function newMessage(kind, text) {
  const msg = {
    id: `m-${nextId++}`,
    kind,
    text,
    sentAt: new Date().toISOString(),
  };
  inbox.push(msg);
  return msg;
}

function render(msg) {
  return `Message ${msg.id} from the review server: ${msg.text}\nAnswer it by calling the reply tool with message_id "${msg.id}".`;
}

// ---- MCP server per session --------------------------------------------------

function createServer(key) {
  const server = new Server(
    { name: 'review-server', version: '0.0.1' },
    {
      capabilities: {
        logging: {},
        tools: { listChanged: true },
        prompts: { listChanged: true },
        resources: { subscribe: true, listChanged: true },
        // Claude Code channels capability. Declared so we can observe whether a
        // client ignores notifications/claude/channel without the Claude flag.
        experimental: { 'claude/channel': {} },
      },
      instructions:
        'This server relays messages from a code review server. Answer each message with the reply tool and its message_id.',
    },
  );
  const sess = {
    server,
    key,
    subscriptions: new Set(),
    activeTasks: new Set(),
  };

  server.oninitialized = () => {
    log('initialized', {
      key: sess.key,
      clientInfo: server.getClientVersion(),
      clientCapabilities: server.getClientCapabilities(),
    });
  };

  server.setRequestHandler(SetLevelRequestSchema, async (req) => {
    log('logging/setLevel', { key: sess.key, level: req.params.level });
    return {};
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...baseTools, ...dynamicTools.values()],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    const { name, arguments: a = {} } = req.params;
    const progressToken = req.params._meta?.progressToken;
    log('tool_call', { key: sess.key, name, arguments: a, progressToken });
    if (name === 'reply') {
      const original = inbox.find((m) => m.id === a.message_id);
      log('REPLY', {
        key,
        message_id: a.message_id,
        text: a.text,
        known: Boolean(original),
        latency_ms: original ? Date.now() - Date.parse(original.sentAt) : null,
      });
      return {
        content: [{ type: 'text', text: `Reply to ${a.message_id} recorded.` }],
      };
    }
    if (name === 'wait_for_message') {
      const timeout = (a.timeout_seconds ?? 3600) * 1000;
      const heartbeat = (a.heartbeat_seconds ?? 0) * 1000;
      const started = Date.now();
      let hb;
      if (heartbeat && progressToken !== undefined) {
        let n = 0;
        hb = setInterval(() => {
          n++;
          extra
            .sendNotification({
              method: 'notifications/progress',
              params: {
                progressToken,
                progress: n,
                message: 'waiting for a review message',
              },
            })
            .catch((e) =>
              log('heartbeat_error', { key: sess.key, error: String(e) }),
            );
        }, heartbeat);
      }
      const msg = await new Promise((resolve) => {
        if (pollQueue.length) return resolve(pollQueue.shift());
        const waiter = (m) => {
          clearTimeout(timer);
          resolve(m);
        };
        const timer = setTimeout(() => {
          pollWaiters.splice(pollWaiters.indexOf(waiter), 1);
          resolve(null);
        }, timeout);
        extra.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          const i = pollWaiters.indexOf(waiter);
          if (i >= 0) pollWaiters.splice(i, 1);
          log('wait_for_message_aborted', {
            key: sess.key,
            waited_ms: Date.now() - started,
            reason: String(extra.signal.reason),
          });
          resolve(null);
        });
        pollWaiters.push(waiter);
      });
      clearInterval(hb);
      log('wait_for_message_return', {
        key: sess.key,
        waited_ms: Date.now() - started,
        message_id: msg?.id ?? null,
      });
      if (msg) msg.deliveredAt = new Date().toISOString();
      return {
        content: [{ type: 'text', text: msg ? render(msg) : 'no message' }],
      };
    }
    if (name === 'slow_task') {
      const end = Date.now() + (a.seconds ?? 30) * 1000;
      const task = { progressToken, extra, n: 0 };
      sess.activeTasks.add(task);
      try {
        while (Date.now() < end) {
          await new Promise((r) => setTimeout(r, 1000));
          task.n++;
          if (progressToken !== undefined && task.n % 5 === 0) {
            await extra.sendNotification({
              method: 'notifications/progress',
              params: {
                progressToken,
                progress: task.n,
                total: a.seconds,
                message: `working ${task.n}s`,
              },
            });
          }
        }
      } finally {
        sess.activeTasks.delete(task);
      }
      return {
        content: [{ type: 'text', text: `slow_task done after ${a.seconds}s` }],
      };
    }
    if (name === 'check_inbox') {
      return {
        content: [
          {
            type: 'text',
            text: inbox.length
              ? inbox.map(render).join('\n\n')
              : 'inbox is empty',
          },
        ],
      };
    }
    if (dynamicTools.has(name)) {
      const msg = inbox.find(
        (m) => `review_message_${m.id.replace('-', '_')}` === name,
      );
      return {
        content: [
          { type: 'text', text: msg ? render(msg) : 'unknown message' },
        ],
      };
    }
    throw new Error(`unknown tool ${name}`);
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [...dynamicPrompts.values()],
  }));
  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    const msg = inbox.find(
      (m) => `review_message_${m.id.replace('-', '_')}` === req.params.name,
    );
    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: msg ? render(msg) : 'unknown message',
          },
        },
      ],
    };
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: 'review://inbox',
        name: 'inbox',
        description: 'Messages from the review server',
        mimeType: 'text/plain',
      },
      ...[...dynamicResources.values()].map((r) => r.resource),
    ],
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const uri = req.params.uri;
    const text =
      uri === 'review://inbox'
        ? inbox.length
          ? inbox.map(render).join('\n\n')
          : 'inbox is empty'
        : (dynamicResources.get(uri)?.text ?? 'not found');
    return { contents: [{ uri, mimeType: 'text/plain', text }] };
  });
  server.setRequestHandler(SubscribeRequestSchema, async (req) => {
    sess.subscriptions.add(req.params.uri);
    log('resources/subscribe', { key: sess.key, uri: req.params.uri });
    return {};
  });
  server.setRequestHandler(UnsubscribeRequestSchema, async (req) => {
    sess.subscriptions.delete(req.params.uri);
    log('resources/unsubscribe', { key: sess.key, uri: req.params.uri });
    return {};
  });

  server.onclose = () => {
    log('session_closed', { key: sess.key });
    sessions.delete(sess.key);
  };
  return sess;
}

// Log every JSON-RPC message in both directions.
function tap(transport, key) {
  const origSend = transport.send.bind(transport);
  transport.send = async (message, options) => {
    log('out', { key, message: trim(message) });
    return origSend(message, options);
  };
  const origStart = transport.start.bind(transport);
  transport.start = async () => {
    const onmessage = transport.onmessage;
    transport.onmessage = (message, extra) => {
      log('in', { key, message: trim(message) });
      onmessage?.(message, extra);
    };
    return origStart();
  };
}

function trim(message) {
  const s = JSON.stringify(message);
  return s.length > 2000 ? s.slice(0, 2000) + '…' : JSON.parse(s);
}

// ---- sending a review message -------------------------------------------------

async function send(kind, text) {
  const msg = newMessage(kind, text);
  log('SEND', { id: msg.id, kind, text, sessions: [...sessions.keys()] });
  const results = [];

  if (kind === 'poll') {
    const waiter = pollWaiters.shift();
    if (waiter) waiter(msg);
    else pollQueue.push(msg);
    return {
      ...msg,
      results: [{ delivered: Boolean(waiter), queued: !waiter }],
    };
  }
  if (kind === 'tool_list_changed') {
    const name = `review_message_${msg.id.replace('-', '_')}`;
    dynamicTools.set(name, {
      name,
      description: `${render(msg)} (Calling this tool returns the same message.)`,
      inputSchema: { type: 'object', properties: {} },
    });
  }
  if (kind === 'prompt_list_changed') {
    const name = `review_message_${msg.id.replace('-', '_')}`;
    dynamicPrompts.set(name, { name, description: render(msg) });
  }
  if (kind === 'resource_list_changed') {
    const uri = `review://messages/${msg.id}`;
    dynamicResources.set(uri, {
      resource: {
        uri,
        name: `message ${msg.id}`,
        description: render(msg),
        mimeType: 'text/plain',
      },
      text: render(msg),
    });
  }
  if (kind === 'progress') pendingProgress.push(msg);

  for (const sess of sessions.values()) {
    const { server, key } = sess;
    try {
      switch (kind) {
        case 'log':
          await server.sendLoggingMessage({
            level: 'warning',
            logger: 'review-server',
            data: render(msg),
          });
          results.push({ key, ok: true });
          break;
        case 'resource_updated':
          if (sess.subscriptions.has('review://inbox') || args.force) {
            await server.sendResourceUpdated({ uri: 'review://inbox' });
            results.push({
              key,
              ok: true,
              subscribed: sess.subscriptions.has('review://inbox'),
            });
          } else {
            // Send anyway and note that the client never subscribed.
            await server.sendResourceUpdated({ uri: 'review://inbox' });
            results.push({ key, ok: true, subscribed: false });
          }
          break;
        case 'resource_list_changed':
          await server.sendResourceListChanged();
          results.push({ key, ok: true });
          break;
        case 'tool_list_changed':
          await server.sendToolListChanged();
          results.push({ key, ok: true });
          break;
        case 'prompt_list_changed':
          await server.sendPromptListChanged();
          results.push({ key, ok: true });
          break;
        case 'progress': {
          const tasks = [...sess.activeTasks].filter(
            (t) => t.progressToken !== undefined,
          );
          for (const t of tasks) {
            await t.extra.sendNotification({
              method: 'notifications/progress',
              params: {
                progressToken: t.progressToken,
                progress: t.n + 0.5,
                message: render(msg),
              },
            });
          }
          results.push({ key, ok: true, tasks: tasks.length });
          break;
        }
        case 'channel':
          await server.notification({
            method: 'notifications/claude/channel',
            params: { content: render(msg), meta: { message_id: msg.id } },
          });
          results.push({ key, ok: true });
          break;
        case 'sampling': {
          const started = Date.now();
          server
            .request(
              {
                method: 'sampling/createMessage',
                params: {
                  messages: [
                    {
                      role: 'user',
                      content: { type: 'text', text: render(msg) },
                    },
                  ],
                  maxTokens: 200,
                },
              },
              CreateMessageResultSchema,
              { timeout: 600000 },
            )
            .then((r) =>
              log('sampling_result', {
                key,
                id: msg.id,
                ms: Date.now() - started,
                result: r,
              }),
            )
            .catch((e) =>
              log('sampling_error', {
                key,
                id: msg.id,
                ms: Date.now() - started,
                error: String(e),
              }),
            );
          results.push({ key, ok: true, async: true });
          break;
        }
        case 'elicitation': {
          const started = Date.now();
          server
            .request(
              {
                method: 'elicitation/create',
                params: {
                  mode: 'form',
                  message: render(msg),
                  requestedSchema: {
                    type: 'object',
                    properties: { reply: { type: 'string', title: 'Reply' } },
                    required: ['reply'],
                  },
                },
              },
              ElicitResultSchema,
              { timeout: 600000 },
            )
            .then((r) =>
              log('elicitation_result', {
                key,
                id: msg.id,
                ms: Date.now() - started,
                result: r,
              }),
            )
            .catch((e) =>
              log('elicitation_error', {
                key,
                id: msg.id,
                ms: Date.now() - started,
                error: String(e),
              }),
            );
          results.push({ key, ok: true, async: true });
          break;
        }
        default:
          throw new Error(`unknown kind ${kind}`);
      }
    } catch (e) {
      results.push({ key, ok: false, error: String(e) });
    }
  }
  log('SEND_RESULT', { id: msg.id, results });
  return { ...msg, results };
}

// ---- HTTP: control API (and MCP in http mode) ---------------------------------

async function readJson(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : undefined;
}

const httpTransports = new Map(); // mcp-session-id -> transport

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/control/send' && req.method === 'POST') {
      const { kind, text } = await readJson(req);
      const out = await send(kind, text);
      res
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify(out, null, 2));
      return;
    }
    if (url.pathname === '/control/status') {
      const out = [...sessions.values()].map((s) => ({
        key: s.key,
        client: s.server.getClientVersion(),
        capabilities: s.server.getClientCapabilities(),
        subscriptions: [...s.subscriptions],
        activeTasks: s.activeTasks.size,
      }));
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify(
          {
            sessions: out,
            pollWaiters: pollWaiters.length,
            pollQueue: pollQueue.length,
          },
          null,
          2,
        ),
      );
      return;
    }
    if (url.pathname === '/mcp' && transportKind === 'http') {
      log('http', {
        method: req.method,
        sessionId: req.headers['mcp-session-id'] ?? null,
        accept: req.headers.accept,
      });
      const sid = req.headers['mcp-session-id'];
      const body = req.method === 'POST' ? await readJson(req) : undefined;
      let transport = sid ? httpTransports.get(sid) : undefined;
      if (!transport) {
        if (req.method !== 'POST' || body?.method !== 'initialize') {
          res.writeHead(404).end(
            JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32001, message: 'Session not found' },
              id: null,
            }),
          );
          return;
        }
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            httpTransports.set(id, transport);
            const sess = createdForTransport.get(transport);
            sess.key = `http:${id.slice(0, 8)}`;
            sessions.set(sess.key, sess);
          },
        });
        transport.onclose = () => {
          if (transport.sessionId) httpTransports.delete(transport.sessionId);
        };
        const sess = createServer('http:pending');
        createdForTransport.set(transport, sess);
        tap(transport, 'http');
        await sess.server.connect(transport);
      }
      await transport.handleRequest(req, res, body);
      return;
    }
    res.writeHead(404).end('not found');
  } catch (e) {
    log('http_error', { error: String(e?.stack ?? e) });
    if (!res.headersSent) res.writeHead(500).end(String(e));
  }
});
const createdForTransport = new WeakMap();

httpServer.on('error', (e) =>
  log('control_listen_error', { port, error: String(e) }),
);
httpServer.listen(port, '127.0.0.1', () =>
  log('listening', { transport: transportKind, port }),
);

if (transportKind === 'stdio') {
  const key = `stdio:${process.pid}`;
  const sess = createServer(key);
  const transport = new StdioServerTransport();
  tap(transport, key);
  sessions.set(key, sess);
  await sess.server.connect(transport);
  log('stdio_connected', { key });
  process.stdin.on('end', () => {
    log('stdin_end', { key });
    process.exit(0);
  });
}
