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

- **Hono serves every request,** through `@hono/node-server`'s
  `createAdaptorServer`, which creates the `node:http` server. The review server
  listens with it on the saved port, or on a random one when the saved port is
  taken, as before. The API is a Hono middleware that passes requests to oRPC's
  fetch `RPCHandler` ([0025](0025-contract-first-orpc-over-rpc.md)), and the
  review UI's files are served with `@hono/node-server`'s `serveStatic`, with
  `index.html` for any path that isn't a file.
- **The `Host` check is Hono's first middleware.** It reads the `Host` header
  Node received, and answers 403 unless it's the review server's own. The
  adapter builds each request's URL from `Host`, so it's given `127.0.0.1` as
  the host for a request with none, and Node's own check for a missing `Host` is
  turned off. A request with no `Host` reaches the middleware and gets 403, as
  [0031](0031-the-review-ui-gets-the-token-in-the-url-fragment.md) says. A
  `Host` the adapter can't build a URL from, such as `a b`, gets 400 from the
  adapter before any middleware runs, so nothing is served either.
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
- A `Host` that isn't a valid host gets 400 from the adapter, not 403 from the
  `Host` check.
- `serveStatic` logs a warning when the review UI isn't built.

## Follow-up design choices

- **Other middleware.** Whether logging, compression, or caching headers for the
  review UI's files use Hono's middleware.
