// Starts the review server: it creates the state directory, migrates the
// database, then serves the API under /api and the built review UI everywhere
// else, on 127.0.0.1. Every request must name the review server in its Host
// header, and every API call must carry the token (decision 0031).
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ORPCError, ValidationError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/node';
import { apiPrefix } from '@agent-diff/shared/contract';
import { readConfig, serverUrl, statePaths } from '@agent-diff/shared/state';
import { createToken, isAuthorized, isOwnHost } from './auth.ts';
import { migrate } from './migrate.ts';
import { createRouter } from './router.ts';
import { ensureStateDir, writeConfig } from './state.ts';
import { defaultUiDir, serveUi } from './static.ts';
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
  // Later starts reuse the token, and a config file without one gets one.
  const token = saved?.token || createToken();

  const store = new Store(paths.database);
  const handler = new RPCHandler(createRouter(store), {
    // Runs for every request under the prefix, before the procedure is
    // matched or its input decoded, so paths that aren't procedures need the
    // token too. oRPC answers the error with 401.
    interceptors: [
      ({ request, next }) => {
        const { authorization } = request.headers;
        if (
          typeof authorization === 'string' &&
          isAuthorized(authorization, token)
        ) {
          return next();
        }
        throw new ORPCError('UNAUTHORIZED', {
          message: 'The token is missing or wrong.',
        });
      },
    ],
    clientInterceptors: [({ next }) => next().catch(readableValidationErrors)],
  });
  // Set once the review server is listening, before any request arrives.
  let port = 0;
  // Node would answer a request with no Host header with 400 itself. It's
  // rejected with 403 like any other Host that isn't the review server.
  const server = createServer(
    { requireHostHeader: false },
    async (req, res) => {
      if (!isOwnHost(req.headers, port)) {
        res.writeHead(403).end();
        return;
      }
      try {
        const { matched } = await handler.handle(req, res, {
          prefix: apiPrefix,
        });
        if (!matched) await serveUi(uiDir, req, res);
      } catch (error) {
        console.error(error);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      }
    },
  );

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
