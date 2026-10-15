import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import * as z from 'zod';
import { checkRequest, port } from './shared/config.ts';
import { AddComment, CreateReviewSession } from './shared/schemas.ts';
import { Store } from './shared/store.ts';

const store = new Store();

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let text = '';
  for await (const chunk of req) text += chunk;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T | { error: string } {
  const result = schema.safeParse(value);
  return result.success
    ? result.data
    : { error: z.prettifyError(result.error) };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const denied = checkRequest(req.headers.host, req.headers.authorization);
  if (denied) return send(res, denied.status, { error: denied.error });

  if (req.method === 'GET' && url.pathname === '/api/health')
    return send(res, 200, { ok: true });

  if (req.method === 'GET' && url.pathname === '/api/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
    });
    res.write(': connected\n\n');
    const stop = store.onComment((c) =>
      res.write(`event: comment-added\ndata: ${JSON.stringify(c)}\n\n`),
    );
    req.on('close', stop);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/review-sessions') {
    const input = parse(CreateReviewSession, await readJson(req));
    if ('error' in input) return send(res, 400, input);
    return send(res, 201, store.createReviewSession(input));
  }

  const match = /^\/api\/review-sessions\/([^/]+)(\/comments)?$/.exec(
    url.pathname,
  );
  if (match && req.method === 'GET' && !match[2]) {
    const session = store.getReviewSession(match[1]!);
    return session
      ? send(res, 200, session)
      : send(res, 404, { error: 'Review session not found' });
  }
  if (match && req.method === 'POST' && match[2]) {
    const input = parse(AddComment, await readJson(req));
    if ('error' in input) return send(res, 400, input);
    const comment = store.addComment(match[1]!, input);
    return comment
      ? send(res, 201, comment)
      : send(res, 404, { error: 'Review session not found' });
  }

  send(res, 404, { error: `No route for ${req.method} ${url.pathname}` });
});

server.listen(port, '127.0.0.1');
