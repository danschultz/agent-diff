// Serves the built review UI from packages/ui/dist, with node:http.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';

export const defaultUiDir = path.join(
  import.meta.dirname,
  '..',
  '..',
  'ui',
  'dist',
);

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

// Serves a file from uiDir, or index.html for any path that isn't a file, so
// the review UI can have its own routes.
export async function serveUi(
  uiDir: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' }).end();
    return;
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(
      new URL(req.url ?? '/', 'http://localhost').pathname,
    );
  } catch {
    res.writeHead(400).end();
    return;
  }
  let file = path.join(uiDir, pathname);
  if (file !== uiDir && !file.startsWith(uiDir + path.sep)) {
    res.writeHead(404).end();
    return;
  }
  if (!(await isFile(file))) file = path.join(uiDir, 'index.html');
  if (!(await isFile(file))) {
    res
      .writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      .end(
        "The review UI isn't built. Run `npm run build -w packages/ui` at the repo root.\n",
      );
    return;
  }
  res.writeHead(200, {
    'content-type':
      contentTypes[path.extname(file)] ?? 'application/octet-stream',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}
