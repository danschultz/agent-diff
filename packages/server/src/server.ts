// Starts the review server: it creates the state directory, migrates the
// database, then serves the API under /api and the built review UI everywhere
// else, on 127.0.0.1, with Hono (decision 0032). Every request must name the
// review server in its Host header, and every API call must carry the token
// (0031).
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { getRequestListener } from '@hono/node-server';
import { ORPCError, ValidationError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';
import { Hono } from 'hono';
import { apiPrefix } from '@agent-diff/shared/contract';
import { readConfig, serverUrl, statePaths } from '@agent-diff/shared/state';
import { createToken, isOwnHost, requireToken } from './auth.ts';
import { migrate } from './migrate.ts';
import { createRouter } from './router.ts';
import { ensureStateDir, writeConfig } from './state.ts';
import { defaultUiDir, reviewUi } from './static.ts';
import { Store } from './store.ts';

export interface StartOptions {
  // Where the state directory is found, through `XDG_STATE_HOME`.
  env?: NodeJS.ProcessEnv;
  // The built review UI. Defaults to packages/ui/dist.
  uiDir?: string;
}

export interface ReviewServer {
  port: number;
  // The review server's address, without the token.
  url: string;
  // The token every API call must carry, saved in the config file.
  token: string;
  // Stops serving and closes the database.
  close(): Promise<void>;
}

// Replaces oRPC's "Input validation failed" with the schemas' own messages,
// so the CLI can print them as they are.
function readableValidationErrors(error: unknown): never {
  if (
    error instanceof ORPCError &&
    error.code === 'BAD_REQUEST' &&
    error.cause instanceof ValidationError
  ) {
    throw new ORPCError('BAD_REQUEST', {
      message: error.cause.issues.map((issue) => issue.message).join(' '),
      cause: error.cause,
    });
  }
  throw error;
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onError);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

// Listens on the saved port, or on a random free port when there's no saved
// port or another program is using it (0024).
async function listenOnSavedPort(
  server: Server,
  saved: number | undefined,
): Promise<number> {
  if (saved !== undefined) {
    try {
      return await listen(server, saved);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    }
  }
  return listen(server, 0);
}

export async function startReviewServer(
  options: StartOptions = {},
): Promise<ReviewServer> {
  const paths = statePaths(options.env);
  const uiDir = options.uiDir ?? defaultUiDir;
  ensureStateDir(paths);
  await migrate(paths.database);
  const saved = readConfig(paths);
  const token = saved?.token ?? createToken();

  const store = new Store(paths.database);
  const handler = new RPCHandler(createRouter(store), {
    interceptors: [requireToken(token)],
    clientInterceptors: [({ next }) => next().catch(readableValidationErrors)],
  });
  const app = new Hono()
    .use(async (c, next) => {
      const { matched, response } = await handler.handle(c.req.raw, {
        prefix: apiPrefix,
      });
      if (matched) return c.newResponse(response.body, response);
      await next();
    })
    .route('/', reviewUi(uiDir));
  // Without replacing the global Request and Response, which the CLI uses
  // too when it runs the review server in its own process.
  const listener = getRequestListener(app.fetch, {
    overrideGlobalObjects: false,
  });

  // Set once the review server is listening, before any request arrives.
  let port = 0;
  // The Host check runs before Hono, which builds each request's URL from
  // the Host header and would answer a missing one with 400 itself. Node
  // would too, so every Host that isn't the review server gets 403.
  const server = createServer({ requireHostHeader: false }, (req, res) => {
    if (!isOwnHost(req.headers, port)) {
      res.writeHead(403).end();
      return;
    }
    void listener(req, res);
  });

  try {
    port = await listenOnSavedPort(server, saved?.port);
  } catch (error) {
    store.close();
    throw error;
  }
  writeConfig(paths, { port, token });

  return {
    port,
    url: serverUrl(port),
    token,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          store.close();
          if (error) reject(error);
          else resolve();
        });
        server.closeAllConnections();
      }),
  };
}
