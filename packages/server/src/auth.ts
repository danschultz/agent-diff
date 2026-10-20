// Keeps everyone but the user who started the review server out, from
// decisions 0001, 0024, and 0031: every API call carries the token from the
// config file, and names the review server in its Host header.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { type Context, ORPCError } from '@orpc/server';
import type {
  StandardHandleResult,
  StandardHandlerInterceptorOptions,
} from '@orpc/server/standard';
import type { Interceptor } from '@orpc/shared';

// 32 random bytes in base64url, which is 43 characters with no padding.
export function createToken(): string {
  return randomBytes(32).toString('base64url');
}

function digest(text: string): Buffer {
  return createHash('sha256').update(text).digest();
}

// Whether the Authorization header is `Bearer <token>`. The tokens are
// compared through their digests, which have the same length, so the
// comparison takes the same time however much of the token matches.
export function isAuthorized(
  authorization: string | undefined,
  token: string,
): boolean {
  const match = /^Bearer ([^ ]+)$/i.exec(authorization ?? '');
  return match !== null && timingSafeEqual(digest(match[1]!), digest(token));
}

// Whether the Host header is `127.0.0.1:<port>` or `localhost:<port>`. A
// web page that rebinds its own domain name to 127.0.0.1 sends its own
// domain name, so it's rejected.
export function isOwnHost(headers: IncomingHttpHeaders, port: number): boolean {
  const host = headers.host?.toLowerCase();
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

// An oRPC handler interceptor that rejects a request without the token with
// 401. It runs for every request under the API's prefix, before the procedure
// is matched or its input decoded, so paths that aren't procedures need the
// token too.
export function requireToken(
  token: string,
): Interceptor<
  StandardHandlerInterceptorOptions<Context>,
  Promise<StandardHandleResult>
> {
  return ({ request, next }) => {
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
  };
}
