// Serves the built review UI from packages/ui/dist, with Hono's serveStatic.
import path from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';

export const defaultUiDir = path.join(
  import.meta.dirname,
  '..',
  '..',
  'ui',
  'dist',
);

// Serves a file from uiDir, or index.html for any path that isn't a file, so
// the review UI can have its own routes. serveStatic refuses paths with `..`,
// `//`, `\`, or `%`, which get index.html too, so nothing outside uiDir is
// served.
export function reviewUi(uiDir: string): Hono {
  return new Hono().get(
    '*',
    serveStatic({ root: uiDir }),
    serveStatic({ path: path.join(uiDir, 'index.html') }),
    (c) =>
      c.text(
        "The review UI isn't built. Run `npm run build -w packages/ui` at the repo root.\n",
        404,
      ),
  );
}
