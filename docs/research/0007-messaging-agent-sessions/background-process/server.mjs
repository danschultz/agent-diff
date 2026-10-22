// Prototype review server for the "background process the agent starts" option.
//
// It keeps a queue of messages per agent-session ID. A background process that
// the agent starts (client.mjs) connects and receives them. Replies come back
// with the message's ID and are logged with their latency.
//
//   POST /messages   {session, text}  -> {id}      queue a message
//   GET  /next?session=S&wait=MS      -> one message as JSON, or 204
//   GET  /stream?session=S            -> one JSON line per message, held open
//   GET  /ws?session=S                -> WebSocket, one text frame per message
//   POST /replies    {id, text}       -> logs the reply tied to the message
//   GET  /sessions                    -> connected listeners and queue sizes
//
// When BGPROC_TOKEN is set, every request must send it as a bearer token
// (or ?token= for the WebSocket, since Claude Code's Monitor ws input can't
// set headers).

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';

const port = Number(process.env.BGPROC_PORT ?? 47105);
const token = process.env.BGPROC_TOKEN ?? '';
const logFile = process.env.BGPROC_LOG ?? '';

let nextId = 1;
const queues = new Map(); // session -> [message]
const listeners = new Map(); // session -> Set<{kind, deliver(msg) -> boolean}>
const messages = new Map(); // id -> message

function log(event, fields) {
  const line = JSON.stringify({
    t: new Date().toISOString(),
    event,
    ...fields,
  });
  console.log(line);
  if (logFile) appendFileSync(logFile, line + '\n');
}

function authorized(req, url) {
  if (!token) return true;
  return (
    req.headers.authorization === `Bearer ${token}` ||
    url.searchParams.get('token') === token
  );
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch (e) {
        reject(e);
      }
    });
  });
}

function publicMessage(m) {
  return { id: m.id, session: m.session, text: m.text, sentAt: m.sentAt };
}

// Hand the session's queued messages to its first listener that accepts them.
function flush(session) {
  const q = queues.get(session) ?? [];
  const set = listeners.get(session);
  while (q.length > 0 && set && set.size > 0) {
    const m = q[0];
    let delivered = false;
    for (const l of set) {
      if (l.deliver(publicMessage(m))) {
        delivered = true;
        m.deliveredAt = Date.now();
        log('delivered', {
          id: m.id,
          session,
          via: l.kind,
          ms: m.deliveredAt - m.sentAt,
        });
        break;
      }
    }
    if (!delivered) break;
    q.shift();
  }
}

function addListener(session, l) {
  if (!listeners.has(session)) listeners.set(session, new Set());
  listeners.get(session).add(l);
  log('listener-open', { session, via: l.kind });
  flush(session);
}

function removeListener(session, l) {
  listeners.get(session)?.delete(l);
  log('listener-close', { session, via: l.kind });
}

// Minimal WebSocket (RFC 6455) server side: handshake and unmasked text frames.
function wsAccept(req, socket) {
  const key = req.headers['sec-websocket-key'];
  const accept = createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
}

function wsText(socket, text) {
  const payload = Buffer.from(text);
  let header;
  if (payload.length < 126) header = Buffer.from([0x81, payload.length]);
  else {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  }
  socket.write(Buffer.concat([header, payload]));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!authorized(req, url)) {
    res.writeHead(401).end('unauthorized\n');
    return;
  }
  const session = url.searchParams.get('session') ?? '';

  if (req.method === 'POST' && url.pathname === '/messages') {
    const body = await readJson(req);
    const m = {
      id: `m${nextId++}`,
      session: body.session,
      text: body.text,
      sentAt: Date.now(),
    };
    messages.set(m.id, m);
    if (!queues.has(m.session)) queues.set(m.session, []);
    queues.get(m.session).push(m);
    const open = listeners.get(m.session)?.size ?? 0;
    log('sent', {
      id: m.id,
      session: m.session,
      text: m.text,
      listeners: open,
    });
    flush(m.session);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({ id: m.id, queuedForLater: !m.deliveredAt }) + '\n',
    );
    return;
  }

  if (req.method === 'GET' && url.pathname === '/next') {
    const wait = Number(url.searchParams.get('wait') ?? 25 * 60 * 1000);
    let done = false;
    const l = {
      kind: 'next',
      deliver(m) {
        if (done) return false;
        done = true;
        clearTimeout(timer);
        removeListener(session, l);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(m) + '\n');
        return true;
      },
    };
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      removeListener(session, l);
      res.writeHead(204).end();
    }, wait);
    req.on('close', () => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        removeListener(session, l);
      }
    });
    addListener(session, l);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/stream') {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    res.write(JSON.stringify({ hello: session }) + '\n');
    let open = true;
    const l = {
      kind: 'stream',
      deliver(m) {
        if (!open) return false;
        res.write(JSON.stringify(m) + '\n');
        return true;
      },
    };
    req.on('close', () => {
      open = false;
      removeListener(session, l);
    });
    addListener(session, l);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/replies') {
    const body = await readJson(req);
    const m = messages.get(body.id);
    if (!m) {
      log('reply-unknown-id', { id: body.id, text: body.text });
      res.writeHead(404).end('unknown message id\n');
      return;
    }
    m.repliedAt = Date.now();
    log('reply', {
      id: m.id,
      session: m.session,
      from: body.session ?? null,
      text: body.text,
      sendToReplyMs: m.repliedAt - m.sentAt,
      deliverToReplyMs: m.deliveredAt ? m.repliedAt - m.deliveredAt : null,
    });
    res.writeHead(200).end('ok\n');
    return;
  }

  if (req.method === 'GET' && url.pathname === '/sessions') {
    const out = {};
    for (const s of new Set([...queues.keys(), ...listeners.keys()])) {
      out[s] = {
        listeners: [...(listeners.get(s) ?? [])].map((l) => l.kind),
        queued: (queues.get(s) ?? []).map((m) => m.id),
      };
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out, null, 2) + '\n');
    return;
  }

  res.writeHead(404).end('not found\n');
});

server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/ws' || !authorized(req, url)) {
    socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
    return;
  }
  const session = url.searchParams.get('session') ?? '';
  wsAccept(req, socket);
  let open = true;
  const l = {
    kind: 'ws',
    deliver(m) {
      if (!open) return false;
      wsText(socket, JSON.stringify(m));
      return true;
    },
  };
  socket.on('close', () => {
    open = false;
    removeListener(session, l);
  });
  socket.on('error', () => {});
  socket.on('data', () => {}); // Ignore client frames (pings, close).
  addListener(session, l);
});

server.listen(port, '127.0.0.1', () =>
  log('listening', { port, auth: !!token }),
);
