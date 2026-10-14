// The review server: API, live events, and the review UI on one localhost port.
//
//   node src/server/main.ts [--port 4317] [--static]
//
// By default the UI is served through Vite in middleware mode, so no build
// step is needed. --static serves the production build in dist/ instead,
// which is closer to real rendering performance (run `npx vite build` first).

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  dataDir,
  defaultPort,
  prototypeDir,
  serverInfoFile,
  type ServerInfo,
} from '../shared/paths.ts';
import { Db } from './db.ts';
import { Api } from './http.ts';
import { ReviewService } from './service.ts';

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: String(defaultPort) },
    static: { type: 'boolean', default: false },
  },
});
const port = Number(values.port);

mkdirSync(dataDir, { recursive: true });
const db = new Db(path.join(dataDir, 'agent-diff.sqlite'));
let api: Api | null = null;
const service = new ReviewService(db, dataDir, (event) =>
  api?.broadcast(event),
);
api = new Api(service, port);

const server = createServer();
const ui = values.static ? staticUi() : await viteUi();

server.on('request', async (req, res) => {
  try {
    if (await api!.handle(req, res)) return;
    ui(req, res);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `Port ${port} is in use. Another agent-diff server may be running (see ${serverInfoFile}).`,
    );
    process.exit(1);
  }
  throw error;
});

await service.init();
server.listen(port, '127.0.0.1', () => {
  const info: ServerInfo = {
    pid: process.pid,
    port,
    url: `http://127.0.0.1:${port}`,
    startedAt: new Date().toISOString(),
  };
  writeFileSync(serverInfoFile, JSON.stringify(info, null, 2));
  console.log(
    `agent-diff review server on ${info.url} (data in ${dataDir}${values.static ? ', static UI' : ''})`,
  );
});

const shutdown = () => {
  service.shutdown();
  try {
    const info = JSON.parse(readFileSync(serverInfoFile, 'utf8')) as ServerInfo;
    if (info.pid === process.pid) rmSync(serverInfoFile);
  } catch {}
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function viteUi(): Promise<
  (req: IncomingMessage, res: ServerResponse) => void
> {
  const { createServer: createVite } = await import('vite');
  const vite = await createVite({
    configFile: path.join(prototypeDir, 'vite.config.ts'),
    server: { middlewareMode: true, hmr: { server } },
    appType: 'spa',
  });
  return (req, res) => vite.middlewares(req, res);
}

function staticUi(): (req: IncomingMessage, res: ServerResponse) => void {
  const dist = path.join(prototypeDir, 'dist');
  if (!existsSync(path.join(dist, 'index.html'))) {
    console.error(
      'No build in dist/. Run `npx vite build` first, or start without --static.',
    );
    process.exit(1);
  }
  const types: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.ttf': 'font/ttf',
    '.json': 'application/json',
  };
  return (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let file = path.join(dist, path.normalize(url.pathname));
    if (!file.startsWith(dist) || !existsSync(file) || url.pathname === '/')
      file = path.join(dist, 'index.html');
    res.writeHead(200, {
      'content-type': types[path.extname(file)] ?? 'application/octet-stream',
    });
    res.end(readFileSync(file));
  };
}
