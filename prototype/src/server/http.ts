import { appendFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { cliCommand } from '../shared/paths.ts';
import type { DiffMode, ServerEvent } from '../shared/types.ts';
import { HttpError, type ReviewService } from './service.ts';

const MODES: DiffMode[] = [
  'all',
  'committed',
  'staged',
  'unstaged',
  'last-turn',
];

/** Mutating requests must carry this header, which cross-site pages can't send without a CORS preflight. */
export const WRITE_HEADER = 'x-agent-diff';

type Handler = (ctx: {
  params: string[];
  query: URLSearchParams;
  body: any;
}) => Promise<unknown> | unknown;

export class Api {
  private readonly service: ReviewService;
  private readonly port: number;
  private readonly clients = new Set<ServerResponse>();
  private readonly routes: {
    method: string;
    pattern: RegExp;
    handler: Handler;
  }[] = [];

  constructor(service: ReviewService, port: number) {
    this.service = service;
    this.port = port;
    this.defineRoutes();
    setInterval(() => {
      for (const client of this.clients) client.write(': keepalive\n\n');
    }, 15000).unref();
  }

  broadcast(event: ServerEvent): void {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of this.clients) client.write(data);
  }

  /** Returns false when the request isn't for the API. */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(
      req.url ?? '/',
      `http://${req.headers.host ?? 'localhost'}`,
    );
    if (!url.pathname.startsWith('/api/')) return false;

    const allowedHosts = [`127.0.0.1:${this.port}`, `localhost:${this.port}`];
    if (!allowedHosts.includes(req.headers.host ?? ''))
      return send(res, 403, { error: 'Unexpected Host header' });
    if (req.method !== 'GET' && req.headers[WRITE_HEADER] !== '1') {
      return send(res, 403, {
        error: `Write requests need the ${WRITE_HEADER}: 1 header`,
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      this.clients.add(res);
      req.on('close', () => this.clients.delete(res));
      return true;
    }

    for (const route of this.routes) {
      if (route.method !== req.method) continue;
      const match = route.pattern.exec(url.pathname);
      if (!match) continue;
      try {
        const body = req.method === 'GET' ? null : await readJson(req);
        const result = await route.handler({
          params: match.slice(1).map(decodeURIComponent),
          query: url.searchParams,
          body,
        });
        return send(res, 200, result ?? { ok: true });
      } catch (error) {
        const status = error instanceof HttpError ? error.status : 500;
        if (status === 500) console.error(error);
        return send(res, status, { error: (error as Error).message });
      }
    }
    return send(res, 404, {
      error: `No route for ${req.method} ${url.pathname}`,
    });
  }

  private route(method: string, pattern: string, handler: Handler): void {
    const regex = new RegExp(
      '^' + pattern.replace(/:[a-zA-Z]+/g, '([^/]+)') + '$',
    );
    this.routes.push({ method, pattern: regex, handler });
  }

  private defineRoutes(): void {
    const s = this.service;
    const mode = (q: URLSearchParams): DiffMode => {
      const m = (q.get('mode') ?? 'all') as DiffMode;
      if (!MODES.includes(m))
        throw new HttpError(400, `Unknown diff mode ${m}`);
      return m;
    };
    const snapshot = (q: URLSearchParams) =>
      q.get('snapshot') ? Number(q.get('snapshot')) : null;

    this.route('GET', '/api/health', () => ({ ok: true, pid: process.pid }));
    this.route('GET', '/api/state', async () => ({
      reviewSessions: await s.listReviewSessions(),
      agents: s.agents(),
      settings: s.settings,
      cli: cliCommand,
    }));

    this.route('POST', '/api/review-sessions', ({ body }) =>
      s.startReviewSession(body),
    );
    this.route('GET', '/api/review-sessions/:rs', ({ params }) =>
      s.reviewSessionInfo(params[0]),
    );
    this.route(
      'POST',
      '/api/review-sessions/:rs/workspaces',
      ({ params, body }) => s.addWorkspace(params[0], body),
    );
    this.route('POST', '/api/review-sessions/:rs/end', ({ params }) =>
      s.endReviewSession(params[0]),
    );

    this.route(
      'GET',
      '/api/review-sessions/:rs/workspaces/:ws/files',
      ({ params, query }) =>
        s.files(params[0], params[1], mode(query), snapshot(query)),
    );
    this.route(
      'GET',
      '/api/review-sessions/:rs/workspaces/:ws/file',
      ({ params, query }) => {
        const file = query.get('path');
        if (!file) throw new HttpError(400, 'path is required');
        return s.file(
          params[0],
          params[1],
          mode(query),
          file,
          query.get('oldPath'),
          snapshot(query),
        );
      },
    );
    this.route(
      'GET',
      '/api/review-sessions/:rs/workspaces/:ws/snapshots',
      ({ params }) => s.snapshots(params[1]),
    );

    this.route(
      'GET',
      '/api/review-sessions/:rs/comments',
      ({ params, query }) =>
        s.placedComments(params[0], mode(query), snapshot(query)),
    );
    this.route(
      'POST',
      '/api/review-sessions/:rs/comments',
      ({ params, body }) => s.createComment(params[0], body),
    );
    this.route('PATCH', '/api/comments/:id', ({ params, body }) =>
      s.updateComment(params[0], body?.body),
    );
    this.route('DELETE', '/api/comments/:id', ({ params }) =>
      s.deleteComment(params[0]),
    );

    this.route('GET', '/api/review-sessions/:rs/reviews', ({ params }) =>
      s.reviews(params[0]),
    );
    this.route('POST', '/api/review-sessions/:rs/reviews', ({ params }) =>
      s.submitReview(params[0]),
    );
    this.route('POST', '/api/notifications/:id/resend', ({ params }) =>
      s.resendNotification(params[0]),
    );

    this.route('POST', '/api/agents', async ({ body }) => {
      s.registerAgent(body);
      if (body.workspace)
        await s.registerAgentWorkspace(body.id, body.workspace);
      return { ok: true };
    });
    this.route('POST', '/api/agents/:id/turn', ({ params, body }) =>
      s.turn(params[0], body),
    );

    this.route('GET', '/api/feedback/pending', ({ query }) => {
      const workspace = query.get('workspace');
      if (!workspace) throw new HttpError(400, 'workspace is required');
      return s.pendingFeedbackFor(workspace);
    });
    this.route('POST', '/api/feedback', ({ body }) => s.feedback(body));

    this.route('POST', '/api/workspaces/snapshot', async ({ body }) => {
      const ws = await s.openWorkspace(body.workspace);
      return s.createSnapshot(
        ws,
        body.reason ?? 'manual',
        body.agentId ?? null,
      );
    });

    this.route('GET', '/api/settings', () => s.settings);
    this.route('POST', '/api/settings', ({ body }) => s.updateSettings(body));

    this.route('POST', '/api/metrics', ({ body }) => {
      appendFileSync(
        path.join(s.dataDir, 'metrics.jsonl'),
        JSON.stringify({ at: new Date().toISOString(), ...body }) + '\n',
      );
      return { ok: true };
    });
  }
}

function send(res: ServerResponse, status: number, body: unknown): true {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
  return true;
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Request body must be JSON');
  }
}
