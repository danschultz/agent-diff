// The prototype review server. Channel servers, one per agent session, hold
// an event stream open to it. `POST /send` sends a message with an ID to one
// agent session, and the agent's reply comes back on `POST /channel/reply`
// with the same ID. Every event is logged with a timestamp.
import { createServer, type ServerResponse } from 'node:http';

const port = Number(process.env.PORT ?? 47101);

interface Session {
  sid: string;
  label: string;
  pid: string;
  res: ServerResponse;
  connectedAt: number;
}

const sessions = new Map<string, Session>();
const sent = new Map<string, { sid: string; at: number }>();
let nextSession = 1;
let nextMessage = 1;

function log(event: string, data: object = {}): void {
  console.log(`${new Date().toISOString()} ${event} ${JSON.stringify(data)}`);
}

function push(session: Session, event: object): void {
  session.res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function findSession(to: string | undefined): Session | undefined {
  if (to) {
    return (
      sessions.get(to) ?? [...sessions.values()].find((s) => s.label === to)
    );
  }
  return sessions.size === 1 ? [...sessions.values()][0] : undefined;
}

async function readJson(req: import('node:http').IncomingMessage) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

function json(res: ServerResponse, status: number, body: object): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body) + '\n');
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const route = `${req.method} ${url.pathname}`;
  try {
    if (route === 'GET /channel/connect') {
      const session: Session = {
        sid: `s${nextSession++}`,
        label: url.searchParams.get('label') ?? '',
        pid: url.searchParams.get('pid') ?? '',
        res,
        connectedAt: Date.now(),
      };
      sessions.set(session.sid, session);
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
      });
      push(session, { type: 'hello', sid: session.sid });
      log('session.connected', {
        sid: session.sid,
        label: session.label,
        channel_pid: session.pid,
      });
      req.on('close', () => {
        sessions.delete(session.sid);
        log('session.disconnected', {
          sid: session.sid,
          label: session.label,
          after_s: (Date.now() - session.connectedAt) / 1000,
        });
      });
      return;
    }
    if (route === 'GET /sessions') {
      return json(
        res,
        200,
        [...sessions.values()].map(({ sid, label, pid }) => ({
          sid,
          label,
          pid,
        })),
      );
    }
    if (route === 'POST /send') {
      const { to, text } = await readJson(req);
      const session = findSession(to);
      if (!session) return json(res, 404, { error: 'no such agent session' });
      const message_id = `m${nextMessage++}`;
      sent.set(message_id, { sid: session.sid, at: Date.now() });
      push(session, { type: 'message', message_id, text });
      log('message.sent', { message_id, sid: session.sid, text });
      return json(res, 200, { message_id, sid: session.sid });
    }
    if (route === 'POST /verdict') {
      const { to, request_id, behavior } = await readJson(req);
      const session = findSession(to);
      if (!session) return json(res, 404, { error: 'no such agent session' });
      push(session, { type: 'verdict', request_id, behavior });
      log('verdict.sent', { sid: session.sid, request_id, behavior });
      return json(res, 200, { ok: true });
    }
    if (route === 'POST /channel/info') {
      log('session.info', await readJson(req));
      return json(res, 200, { ok: true });
    }
    if (route === 'POST /channel/delivered') {
      const { sid, message_id } = await readJson(req);
      const m = sent.get(message_id);
      log('message.written_to_stdio', {
        sid,
        message_id,
        ms: m ? Date.now() - m.at : null,
      });
      return json(res, 200, { ok: true });
    }
    if (route === 'POST /channel/reply') {
      const { sid, message_id, text } = await readJson(req);
      const m = sent.get(message_id);
      if (!m) {
        log('reply.unknown_message', { sid, message_id, text });
        return json(res, 404, { error: `unknown message_id ${message_id}` });
      }
      log('reply.received', {
        sid,
        message_id,
        sent_to: m.sid,
        ms_since_sent: Date.now() - m.at,
        text,
      });
      return json(res, 200, { ok: true });
    }
    if (route === 'POST /channel/permission-request') {
      log('permission.request', await readJson(req));
      return json(res, 200, { ok: true });
    }
    json(res, 404, { error: `no route ${route}` });
  } catch (err) {
    log('error', { route, message: (err as Error).message });
    json(res, 500, { error: (err as Error).message });
  }
});

server.listen(port, '127.0.0.1', () => {
  log('listening', { url: `http://127.0.0.1:${port}` });
});
