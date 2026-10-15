# 0021: The review server's API is built with oRPC, and validated with Valibot

- Status: Accepted
- Date: 2026-10-15

## Problem

[0011](0011-api-core-with-cli-client.md) makes the
[review server](../glossary.md#review-server)'s HTTP API the core, called by the
[review UI](../glossary.md#review-ui) and by the `agent-diff` CLI.
[0001](0001-local-web-app.md) left the backend stack open. The prototype's API
is `node:http` with a hand-written router, request bodies typed `any`, and types
repeated by hand in the review UI and the CLI.

The API needs request validation, response types that clients share without
writing them again, pushed updates for live reload
([0007](0007-live-reload-from-file-watching.md)), a place to check the `Host`
header and token (0001), and fast loading, since the CLI starts a process for
every call.

[0006](../research/0006-review-server-libraries.md) built the same API with
`node:http` and seven frameworks, and the same schemas with six validation
libraries, then repeated the oRPC example with Valibot.

## Solution

The API is built with [oRPC](https://orpc.dev), and its schemas are written with
[Valibot](https://valibot.dev):

- Each route's input, output, and errors are declared with Valibot schemas,
  which oRPC accepts through Standard Schema with no adapter.
- The server implements the routes with `@orpc/server`, so `tsc` rejects a
  handler that returns the wrong shape, and checks such as the token run as
  middleware.
- The review UI and the CLI call the API through `@orpc/client`, typed from the
  same definitions.
- Pushed updates are oRPC event iterators, sent as server-sent events.

From
[0006's example](../research/0006-review-server-libraries/server/orpc-valibot/contract.ts),
where `AddComment` and `Comment` are Valibot schemas:

```ts
addComment: oc
  .route({
    method: 'POST',
    path: '/review-sessions/{id}/comments',
    successStatus: 201,
    inputStructure: 'detailed',
  })
  .errors({ NOT_FOUND })
  .input(v.object({ params: byId, body: AddComment }))
  .output(Comment),
```

## Tradeoffs

Benefits:

- Requests are validated and responses are typed from one set of schemas, for
  the server, the review UI, and the CLI. In 0006, `tsc` rejected a handler that
  returned the wrong response type.
- Typed errors, such as `errors.NOT_FOUND()`, that clients can tell apart, and
  typed event iterators over SSE with `EventPublisher`.
- REST paths and an OpenAPI document can come from the same definitions.
- Valibot is small and quick to load: 0006's schemas bundled to 2.8 KB gzipped
  for the browser, and in 0006 the oRPC client loaded in 352 ms against 579 ms
  with Zod, and the server started in 595 ms against 826 ms.
- Valibot's `partialCheck` reported a check across fields, such as `endLine`
  before `startLine`, alongside the field errors.

Costs:

- oRPC is younger and smaller than the alternatives (5,684 stars when checked)
  and changes quickly, with 261 versions published in the year to 2026-10-14.
- More concepts than a plain router: contracts, implementers, links,
  interceptors, and input structures.
- With REST paths, the client needs the route definitions at run time, so the
  CLI loads the schemas on every call. Hono's client, which needs only types,
  loaded in 250 ms in 0006.
- oRPC's client doesn't expose the HTTP status of a successful call.
- Valibot's pipes are more verbose than Zod's chained methods, and Zod is
  accepted by more libraries.
- Generating an OpenAPI document needs `@orpc/valibot`, whose converter is
  exported as experimental and leaves checks across fields out of the document.

## Follow-up design choices

- **Protocol.** REST paths with `OpenAPIHandler` and `OpenAPILink`, which need
  the route definitions at run time, or oRPC's own protocol with `RPCHandler`
  and `RPCLink`, where clients need only types. 0006 measured only the first.
- **Contract or router first.** Whether routes are declared in a contract with
  `@orpc/contract`, which the server implements and clients import, or derived
  from the server's router.
- **OpenAPI.** Whether to publish an OpenAPI document, which bears on 0011's
  open question of whether harnesses can rely on the API.
- **Error format.** How validation errors are worded for agents reading the
  CLI's output, and whether they keep oRPC's error envelope.
- **Versions.** Whether to pin exact versions while oRPC changes quickly.
- **Command set** and **API shape**, left open in 0011 and
  [0009](0009-review-sessions-and-claims.md).
