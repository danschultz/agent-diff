# 0032: The review server serves the API and the review UI with Hono

- Status: Accepted
- Date: 2026-10-19

## Problem

[0026](0026-workspaces-typescript-7-and-test-stack.md) has the
[review server](../glossary.md#review-server) serve the API and the built
[review UI](../glossary.md#review-ui) with `node:http`: a hand-written request
handler hands requests under `/api` to oRPC, and a hand-written static file
server serves everything else. Each new concern, such as the `Host` check and
the token from [0031](0031-the-review-ui-gets-the-token-in-the-url-fragment.md),
is added by hand to that handler.
[Research 0006](../research/0006-review-server-libraries.md) compared Hono with
`node:http` and other frameworks.

## Solution

- **Hono serves every request,** through `@hono/node-server` on `node:http`. The
  API is a Hono middleware that passes requests to oRPC's fetch `RPCHandler`
  ([0025](0025-contract-first-orpc-over-rpc.md)), and the review UI's files are
  served with `@hono/node-server`'s `serveStatic`, with `index.html` for any
  path that isn't a file.
- **The `Host` check runs before Hono.** Hono's Node adapter builds each
  request's URL from the `Host` header, and answers a request with no `Host`
  with 400 before any middleware runs. Checking `Host` in front of it keeps
  0031's rule that every other `Host`, or none, gets 403.
- **The token stays an oRPC interceptor,** so a rejected call is an oRPC error
  that the CLI and the review UI read as 401.
- **Global objects are left alone.** The adapter is told not to replace the
  global `Request` and `Response`, which the CLI also uses when it runs the
  review server in its own process.

### Effect on earlier decisions

- **[0026](0026-workspaces-typescript-7-and-test-stack.md).** The review server
  serves the built review UI and the API with Hono, not with `node:http`
  directly.

## Tradeoffs

Benefits:

- Routes and middleware, such as the API and static files, are composed with
  Hono instead of written by hand.
- `serveStatic` refuses paths with `..`, `//`, `\`, or `%`, so path traversal
  protection isn't hand-written.
- oRPC's fetch adapter and Hono both use web-standard `Request` and `Response`.

Costs:

- Two more dependencies, `hono` and `@hono/node-server`.
- The `Host` check sits outside Hono, at the `node:http` level, so not every
  check is a Hono middleware.
- `serveStatic` logs a warning when the review UI isn't built.

## Follow-up design choices

- **Other middleware.** Whether logging, compression, or caching headers for the
  review UI's files use Hono's middleware.
