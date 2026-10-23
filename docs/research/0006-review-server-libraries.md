# 0006: Which libraries could build the review server's API, validation, and SQLite storage?

- Date: 2026-10-14

## Question

The [review server](../glossary.md#review-server) needs an HTTP API, input
validation, and SQLite storage before it can be built:

- [0011](../decisions/0011-api-core-with-cli-client.md) makes the HTTP API the
  core. The [review UI](../glossary.md#review-ui) and the `agent-diff` CLI both
  call it, and the CLI is built with Crust
  ([0017](../decisions/0017-crust-builds-the-cli.md)).
- [0001](../decisions/0001-local-web-app.md) says the server binds to localhost
  and requires a token, and leaves "which frontend and backend stack to use"
  open.
- [0006](../decisions/0006-sqlite-review-state.md) stores review state in
  SQLite.
- [0007](../decisions/0007-live-reload-from-file-watching.md) pushes updates to
  the browser when files change.

The prototype's server,
[`prototype/src/server/http.ts`](../../prototype/src/server/http.ts), uses
`node:http` with a hand-written regex router, request bodies typed `any`,
server-sent events (SSE) for pushed updates, and `node:sqlite`
([`db.ts`](../../prototype/src/server/db.ts)). The review UI and the CLI repeat
the API's types by hand.

Dan asked for research into what to use for the backend server, the API,
validation, and the SQLite library. There was no brief, so the comparison uses
the criteria earlier research used for the CLI and the review UI's state
([0004](0004-typescript-cli-libraries.md),
[0002](0002-react-state-management.md)), applied to the server:

- **Types end to end.** Request bodies and parameters are typed from a schema,
  responses are typed, and the review UI and the CLI get the API's types without
  writing them again. What mistakes `tsc` catches.
- **No build step.** The repo runs TypeScript directly on Node 24 with type
  stripping ([`.node-version`](../../.node-version)).
- **Pushed updates.** SSE or WebSocket support, for 0007.
- **Local security.** A place to check the `Host` header and the token on every
  request, for 0001.
- **Startup.** The CLI starts the review server when it isn't running (0011), so
  server startup is on the path of the first command. The CLI also starts a
  process for every call, so the client library's load time matters too. Since
  this research, [0019](../decisions/0019-cli-does-not-start-the-server.md) has
  `agent-diff server start` start the review server instead, so server startup
  is no longer on the path of other commands.
- **Size.** Install size and dependency count.
- **Errors.** What a client sees for invalid input, since agents read the CLI's
  output.
- **Maintenance.** Latest release and release activity.

The command set and API shape are follow-up design choices in 0011 and
[0009](../decisions/0009-review-sessions-and-claims.md). The routes below are
only a common example to compare libraries with.

## Findings

### How this was checked

The same small API was written with each HTTP framework and API library, the
same schemas with each validation library, the same workload with each SQLite
driver, and the same store with each query layer. The examples are in
[`0006-review-server-libraries/`](0006-review-server-libraries/), one directory
per library, each with a `package.json` pinning the version checked:

| Directory                                             | Contents                                                                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [`shared/`](0006-review-server-libraries/shared/)     | The Zod schemas, `node:sqlite` store, port, token, and request checks every server example uses, so only the HTTP code differs. |
| [`server/`](0006-review-server-libraries/server/)     | One `server.ts` and `client.ts` per HTTP framework or API library.                                                              |
| [`validate/`](0006-review-server-libraries/validate/) | One `schemas.ts` per validation library, and a shared harness that checks types, prints errors, and times parsing.              |
| [`sqlite/`](0006-review-server-libraries/sqlite/)     | One `bench.ts` per SQLite driver, running the same [`workload.ts`](0006-review-server-libraries/sqlite/workload.ts).            |
| [`query/`](0006-review-server-libraries/query/)       | One `store.ts` per query layer, implementing the same three methods.                                                            |
| [`tools/`](0006-review-server-libraries/tools/)       | The scripts that type-check, run, and time the examples.                                                                        |

To run them: `npm install` in `tools/` and in each example's directory, then
`tools/sync-shared.sh`, which copies the shared files into each example so
imports resolve from the example's own `node_modules`.

- **Machine:** Intel Atom C3858 (12 cores, 2.0 GHz), 8 GB RAM, Debian 13.7,
  Linux 6.12, the same machine as 0004. Node 24.21.0 and npm 11.19.0. The repo
  pins Node 24.20.0, which wasn't installed. Node 26.11.1 was used for two spot
  checks, noted where they appear.
- **Type-checking:** in a scratch directory outside the repo, each example was
  installed with `npm install` and checked by
  [`tools/check.sh`](0006-review-server-libraries/tools/check.sh) with
  TypeScript 7.0.2 and
  [`tsconfig.base.json`](0006-review-server-libraries/tsconfig.base.json):
  `strict`, `noUncheckedIndexedAccess`, `module: nodenext`,
  `verbatimModuleSyntax`, and `erasableSyntaxOnly`, which rejects syntax that
  type stripping can't run, with `skipLibCheck`.
- **`any` probe:** typed clients pass a response through
  [`notAny`](0006-review-server-libraries/shared/probe.ts), which fails to
  compile when its argument is typed `any`.
- **Running:** every example ran with `node file.ts` on Node 24, using type
  stripping and no build step.
  [`tools/run-example.sh`](0006-review-server-libraries/tools/run-example.sh)
  starts a server, runs its client, and stops the server.
- **Install size:** `npm install` of the pinned versions into an empty
  directory, then `du -sk node_modules` and the number of packages in
  `package-lock.json`. Peer dependencies that npm installs automatically are
  included.
- **Startup:**
  [`tools/bench-startup.mjs`](0006-review-server-libraries/tools/bench-startup.mjs)
  times from spawning `node server.ts` to the first 200 response from
  `/api/health`, 3 warm-up runs and then 30 runs per example, interleaved, and
  reports the median.
  [`tools/bench-import.mjs`](0006-review-server-libraries/tools/bench-import.mjs)
  times `node file.ts` the same way, for load times of clients, schemas, and
  stores.
- **Throughput:**
  [`tools/throughput.mjs`](0006-review-server-libraries/tools/throughput.mjs)
  runs autocannon 8.0.0 against "get session" with 10 connections for 5 seconds.
- **Maintenance:**
  [`tools/maint.py`](0006-review-server-libraries/tools/maint.py) reads the npm
  registry's `time` field and counts the versions published from 2025-10-14 to
  2026-10-14, which includes prereleases and canary builds, then reads stars,
  last push, and the archived flag from the GitHub API. Read on 2026-10-14.

Behaviour comes from running the examples, from each package's README and type
declarations as installed, and from the linked docs.

### The example API

Every server example serves the same routes under `/api`:

```text
GET  /api/health
GET  /api/events                         SSE: a comment-added event for each new comment
POST /api/review-sessions                {workingDirectories: string[], title?: string} -> 201
GET  /api/review-sessions/:id            -> 200, or 404 {error}
POST /api/review-sessions/:id/comments   {path, startLine, endLine, body} -> 201, 400, or 404
```

Every request must have a `Host` of `127.0.0.1:<port>` or `localhost:<port>` and
an `Authorization: Bearer <token>` header, as 0001 requires, or it gets 403
or 401. Bodies are validated with the same Zod schemas
([`shared/schemas.ts`](0006-review-server-libraries/shared/schemas.ts)),
including a check across fields that `endLine` isn't before `startLine`, and
stored with the same `node:sqlite` store
([`shared/store.ts`](0006-review-server-libraries/shared/store.ts)).

Each `client.ts` subscribes to the events, starts a
[session](../glossary.md#session) over two
[working directories](../glossary.md#working-directory), adds a
[comment](../glossary.md#comment), adds an invalid comment (empty body, end line
before start line), fetches the session, fetches one that doesn't exist, and
prints the results with ids and times replaced. Frameworks without a typed
client use the same `fetch` client as the `node:http` baseline, which parses
responses with the shared schemas. The baseline printed:

```json
{
  "created": {
    "status": 201,
    "body": {
      "id": "<id>",
      "title": "Example",
      "workingDirectories": ["/repo/a", "/repo/b"],
      "startedAt": "<time>",
      "comments": []
    }
  },
  "added": {
    "status": 201,
    "body": {
      "id": "<id>",
      "reviewSessionId": "<id>",
      "path": "src/a.ts",
      "startLine": 3,
      "endLine": 4,
      "body": "Rename this.",
      "createdAt": "<time>"
    }
  },
  "invalid": {
    "status": 400,
    "body": {
      "error": "✖ Too small: expected string to have >=1 characters\n  → at body\n✖ endLine must not be before startLine\n  → at endLine"
    }
  },
  "fetched": {
    "status": 200,
    "body": {
      "id": "<id>",
      "title": "Example",
      "workingDirectories": ["/repo/a", "/repo/b"],
      "startedAt": "<time>",
      "comments": [
        {
          "id": "<id>",
          "reviewSessionId": "<id>",
          "path": "src/a.ts",
          "startLine": 3,
          "endLine": 4,
          "body": "Rename this.",
          "createdAt": "<time>"
        }
      ]
    }
  },
  "missing": {
    "status": 404,
    "body": {
      "error": "Session not found"
    }
  },
  "event": {
    "event": "comment-added",
    "data": {
      "id": "<id>",
      "reviewSessionId": "<id>",
      "path": "src/a.ts",
      "startLine": 3,
      "endLine": 4,
      "body": "Rename this.",
      "createdAt": "<time>"
    }
  }
}
```

Every example printed the same output, except for the differences listed under
[Error responses](#error-responses) and [Status codes](#status-codes).

### HTTP frameworks and API libraries

| Candidate              | Version checked                    | Kind                                           | Typed client                              | Validation                                            | SSE                                      | OpenAPI                                        |
| ---------------------- | ---------------------------------- | ---------------------------------------------- | ----------------------------------------- | ----------------------------------------------------- | ---------------------------------------- | ---------------------------------------------- |
| `node:http` (baseline) | Node 24.21.0                       | Built-in server                                | None                                      | By hand                                               | By hand                                  | None                                           |
| Hono                   | 4.13.13, `@hono/node-server` 2.1.5 | Web-standard router, adapter for Node          | `hc`, types from the route chain          | `@hono/standard-validator` 0.4.0, any Standard Schema | `streamSSE` helper                       | Separate packages, such as `@hono/zod-openapi` |
| Fastify                | 5.12.7                             | Node server framework with plugins             | None                                      | Type providers; `fastify-type-provider-zod` 7.0.0     | By hand on the raw response, or a plugin | `@fastify/swagger`, from route schemas         |
| Express                | 5.3.0                              | Node server framework                          | None                                      | By hand                                               | By hand                                  | None built in                                  |
| h3                     | 2.0.2                              | Web-standard router (the server under Nitro)   | None                                      | `readValidatedBody`, any Standard Schema              | `EventStream` class                      | None built in                                  |
| Elysia                 | 1.4.30, `@elysia/node` 1.4.6       | Bun-first framework, adapter for Node          | Eden Treaty 1.4.9                         | Route options, TypeBox or any Standard Schema         | Generator functions with `sse()`         | `@elysiajs/openapi`                            |
| tRPC                   | 11.19.0                            | RPC procedures over HTTP                       | `@trpc/client`, types from the router     | `.input()`, any Standard Schema                       | Subscriptions over SSE                   | None built in                                  |
| oRPC                   | 1.15.6                             | RPC procedures, or REST routes from a contract | `@orpc/client`, from a router or contract | `.input()` and `.output()`, any Standard Schema       | Event iterators over SSE                 | Built in, from the contract                    |

Sources: [Hono RPC](https://hono.dev/docs/guides/rpc),
[Hono streaming](https://hono.dev/docs/helpers/streaming),
[Hono on Node](https://hono.dev/docs/getting-started/nodejs),
[Fastify type providers](https://fastify.dev/docs/latest/Reference/Type-Providers/),
[fastify-type-provider-zod](https://github.com/turkerdev/fastify-type-provider-zod),
[Express error handling](https://expressjs.com/en/guide/error-handling.html),
[h3](https://h3.dev/), [h3 responses](https://h3.dev/utils/response),
[Elysia on Node](https://elysiajs.com/integrations/node),
[Elysia validation](https://elysiajs.com/essential/validation),
[Eden Treaty](https://elysiajs.com/eden/treaty/overview),
[tRPC subscriptions](https://trpc.io/docs/server/subscriptions),
[oRPC OpenAPI](https://orpc.dev/docs/openapi/getting-started),
[oRPC contracts](https://orpc.dev/docs/contract-first/define-contract),
[oRPC event iterators](https://orpc.dev/docs/event-iterator), and
[Standard Schema](https://standardschema.dev), the shared interface that lets a
library accept Zod, Valibot, ArkType, and others.

Koa 3.2.1, ts-rest, and Effect's `HttpApi` weren't built. See
[Candidates not built](#candidates-not-built).

#### Results

Every example type-checked, ran under Node 24 type stripping with no build step,
and served all five routes. Line counts leave out blank lines and comments. The
shared schemas, store, and checks aren't counted. Sizes include Zod, which every
example installs (8,256 KB, 1 package), so the baseline's size is Zod alone.

| Candidate   |           `server.ts` lines | `client.ts` lines | Install       | Server startup | Requests/s |         CLI client load | Wrong response type caught |
| ----------- | --------------------------: | ----------------: | ------------- | -------------: | ---------: | ----------------------: | -------------------------- |
| `node:http` |                          72 |                75 | 8,256 KB, 1   |         651 ms |      1,973 | 227 ms, 490 ms with Zod | No                         |
| Hono        |                          60 |                56 | 11,460 KB, 5  |         757 ms |      1,552 |                  250 ms | No                         |
| Fastify     |                          80 |      75 (`fetch`) | 24,492 KB, 58 |       1,014 ms |      1,746 |          as `node:http` | Yes                        |
| Express     |                          53 |      75 (`fetch`) | 15,208 KB, 77 |         836 ms |      1,221 |          as `node:http` | No                         |
| h3          |                          54 |      75 (`fetch`) | 9,512 KB, 4   |         727 ms |      1,504 |          as `node:http` | No                         |
| Elysia      |                          78 |                69 | 17,148 KB, 22 |       1,239 ms |      1,669 |                  242 ms | Yes                        |
| tRPC        |                          77 |                91 | 42,736 KB, 26 |         720 ms |        439 |                  303 ms | No                         |
| oRPC        | 78, plus 39 in the contract |                60 | 12,124 KB, 26 |         844 ms |      1,047 |                  572 ms | Yes                        |

- **Server startup** includes loading Zod, the shared schemas, and
  `node:sqlite`, which is why the baseline takes 651 ms. A second pass of 20
  runs with Node's compile cache (`NODE_COMPILE_CACHE`) made no consistent
  difference. Elysia was rerun after switching to `@elysia/node`: 1,192 ms
  against 632 ms for the baseline.
- **Requests/s** is for one route that reads three tables from SQLite. The p50
  latency was 4 to 8 ms for every candidate except tRPC, at 20 ms. tRPC's lower
  rate wasn't investigated.
- **CLI client load** is the time to run a file that imports the client library
  and creates a client, without calling the server, as the CLI would on every
  command. Hono, Elysia, and tRPC import the server's types with `import type`,
  which type stripping removes, so no server code loads. oRPC's `OpenAPILink`
  needs the contract at run time, which loads Zod and the schemas. The `fetch`
  client loads in 227 ms without Zod and 490 ms when it parses responses with
  the shared Zod schemas. An empty file took about 189 ms.
- **Wrong response type caught**: each example's "get session" handler was
  changed to return `startedAt` as a number, by
  [`tools/probe-response.py`](0006-review-server-libraries/tools/probe-response.py).
  Fastify, Elysia, and oRPC check handlers against declared response schemas.
  Hono and tRPC infer response types from what the handler returns, so the wrong
  type flows to the client instead. tRPC can declare `.output()` schemas to
  catch it, and Hono can with `@hono/zod-openapi`, neither of which was checked.
- **tRPC's size** is mostly TypeScript: `@trpc/server` declares
  `typescript >=5.7.2` as a required peer dependency, so npm installs TypeScript
  7 (31 MB, with its native binary). An install with `--omit=dev` and
  `typescript` as a dev dependency still installed it (34 MB in all). The tRPC
  client also needed the `eventsource` 5.1.2 package for subscriptions, because
  Node 24 and 26 have no global `EventSource`.
- **Fastify** installs Ajv, Pino, and `@fastify/swagger` (a required peer of
  `fastify-type-provider-zod`) whether or not they're used.

#### Error responses

Each example sends errors as `{ "error": message }`. The validation message is
from the framework where it formats one, or from `z.prettifyError` where the
example formats it. For the invalid comment, the raw responses were (from
[`tools/wire.sh`](0006-review-server-libraries/tools/wire.sh)):

| Candidate                      | Status | Body                                                                                                                                                                               |
| ------------------------------ | -----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node:http`, Hono, Express, h3 |    400 | `{"error":"✖ Too small: expected string to have >=1 characters\n  → at body\n✖ endLine must not be before startLine\n  → at endLine"}`                                             |
| Fastify                        |    400 | `{"error":"body/body Too small: expected string to have >=1 characters, body/endLine endLine must not be before startLine"}` (Fastify's own message)                               |
| Elysia                         |    400 | `{"error":"{\n  \"type\": \"validation\",\n  \"on\": \"body\", … \"errors\": [ … ] }"}`: Elysia's `error.message` is a JSON document                                               |
| tRPC                           |    400 | `{"error":{"message":"✖ Too small … → at comment.body …","code":-32600,"data":{"code":"BAD_REQUEST","httpStatus":400,"stack":"TRPCError: …","path":"reviewSessions.addComment"}}}` |
| oRPC                           |    400 | `{"defined":false,"code":"BAD_REQUEST","status":400,"message":"✖ Too small … → at body.body …"}`                                                                                   |

- Without a hook, Hono's `sValidator` responds with 400 and
  `{ data, error: issues, success: false }`
  ([`@hono/standard-validator`](https://github.com/honojs/middleware/tree/main/packages/standard-validator)).
- tRPC includes stack traces in error responses unless `NODE_ENV` is
  `production`, and wraps inputs with path parameters in the input object, so
  issue paths start with `comment.`. oRPC's detailed input structure puts the
  body under `body`, so paths start with `body.`.
- For a body that isn't JSON, Express 5 answered with an HTML page holding the
  `SyntaxError` and a stack trace with absolute paths, because `NODE_ENV` wasn't
  `production`
  ([Express error handling](https://expressjs.com/en/guide/error-handling.html)).
  Fastify answered with its own JSON error, Hono and Elysia with plain text, and
  h3 and oRPC with JSON.

#### Status codes

tRPC answers 200 for every successful call, including creates; the other
examples answer 201 for creates. oRPC's client doesn't expose the status of a
successful call, so its `client.ts` writes 201 itself. tRPC's routes are
procedure names, such as `POST /api/reviewSessions.addComment` and
`GET /api/reviewSessions.get?input=…`, not REST paths. oRPC served the REST
paths from the contract.

#### Server-sent events

Every candidate served the event stream, with these differences:

- **h3**'s `EventStream` didn't send headers until the first message, so the
  client's `fetch` didn't resolve and the client waited forever. Pushing a
  comment when the stream opens fixed it.
- **Eden** returned the stream as an async iterator, typed from the generator,
  but leaving the loop didn't close the connection, so the client process didn't
  exit. Aborting the request with an `AbortController` fixed it.
- **tRPC** subscriptions are async generators, and the client needs an
  `EventSource` implementation. Browsers have one; Node needs a package
  ([tRPC `httpSubscriptionLink`](https://trpc.io/docs/client/links/httpSubscriptionLink)).
- **oRPC** has an `EventPublisher` and types each event from the contract's
  `eventIterator` schema. The client gets an async iterator.
- **Hono** has `streamSSE`. Fastify and Express write to the Node response
  directly; Fastify needs `reply.hijack()` to do so.

#### OpenAPI

oRPC generated an OpenAPI document from the contract with `OpenAPIGenerator` and
`@orpc/zod`'s `ZodToJsonSchemaConverter`
([`server/orpc/spec.ts`](0006-review-server-libraries/server/orpc/spec.ts)),
with all five paths and their schemas. Fastify, Hono, and Elysia generate one
through separate packages, which weren't checked. Express, h3, and tRPC have
none built in.

#### oRPC with Valibot

Added on 2026-10-15. The oRPC example was repeated with the shared schemas
written in Valibot 1.5.0 instead of Zod
([`server/orpc-valibot/`](0006-review-server-libraries/server/orpc-valibot/)).
Only the schemas, the three `z.object` calls in the contract, and the server's
error formatting (`v.summarize` instead of `z.prettifyError`) changed.

- It type-checked, ran under type stripping, and printed the same output as the
  Zod version, apart from Valibot's wording of the validation message:
  `× Invalid length: Expected >=1 but received 0 → at body.body`,
  `× endLine must not be before startLine → at body.endLine`.
- `tsc` still rejected a handler returning the wrong response type.
- The CLI client loaded in 352 ms, against 579 ms with Zod in the same run.
  Server startup was 595 ms, against 826 ms with Zod and 641 ms for the
  `node:http` baseline (which loads Zod), over 30 interleaved runs. Throughput
  was the same (1,100 and 1,122 requests/s).
- The install was 5,660 KB and 24 packages, including `@orpc/valibot` (28 KB),
  against 12,124 KB and 26 packages with Zod and `@orpc/zod`.
- oRPC validates through Standard Schema, so the server and client need no
  Valibot adapter. `@orpc/valibot` 1.15.6 is only needed to generate the OpenAPI
  document: with it removed, the server and client ran with the same output, and
  only [`spec.ts`](0006-review-server-libraries/server/orpc-valibot/spec.ts)
  failed to compile. Its converter is exported as
  `experimental_ValibotToJsonSchemaConverter`. The document it generated had all
  five paths, the field constraints, and required fields, but left out the
  `partialCheck` across fields without an error.

#### Examples

##### node:http (baseline)

<details>
<summary><code>server/node-http/server.ts</code> (72 lines)</summary>

[Source](0006-review-server-libraries/server/node-http/server.ts)

```ts
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import * as z from 'zod';
import { checkRequest, port } from './shared/config.ts';
import { AddComment, CreateReviewSession } from './shared/schemas.ts';
import { Store } from './shared/store.ts';

const store = new Store();

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let text = '';
  for await (const chunk of req) text += chunk;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T | { error: string } {
  const result = schema.safeParse(value);
  return result.success
    ? result.data
    : { error: z.prettifyError(result.error) };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const denied = checkRequest(req.headers.host, req.headers.authorization);
  if (denied) return send(res, denied.status, { error: denied.error });

  if (req.method === 'GET' && url.pathname === '/api/health')
    return send(res, 200, { ok: true });

  if (req.method === 'GET' && url.pathname === '/api/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
    });
    res.write(': connected\n\n');
    const stop = store.onComment((c) =>
      res.write(`event: comment-added\ndata: ${JSON.stringify(c)}\n\n`),
    );
    req.on('close', stop);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/review-sessions') {
    const input = parse(CreateReviewSession, await readJson(req));
    if ('error' in input) return send(res, 400, input);
    return send(res, 201, store.createReviewSession(input));
  }

  const match = /^\/api\/review-sessions\/([^/]+)(\/comments)?$/.exec(
    url.pathname,
  );
  if (match && req.method === 'GET' && !match[2]) {
    const session = store.getReviewSession(match[1]!);
    return session
      ? send(res, 200, session)
      : send(res, 404, { error: 'Session not found' });
  }
  if (match && req.method === 'POST' && match[2]) {
    const input = parse(AddComment, await readJson(req));
    if ('error' in input) return send(res, 400, input);
    const comment = store.addComment(match[1]!, input);
    return comment
      ? send(res, 201, comment)
      : send(res, 404, { error: 'Session not found' });
  }

  send(res, 404, { error: `No route for ${req.method} ${url.pathname}` });
});

server.listen(port, '127.0.0.1');
```

</details>

The `fetch` client the baseline, Fastify, Express, and h3 share:

<details>
<summary><code>server/node-http/client.ts</code> (75 lines)</summary>

[Source](0006-review-server-libraries/server/node-http/client.ts)

```ts
import * as z from 'zod';
import { baseUrl, token } from './shared/config.ts';
import {
  Comment,
  ErrorBody,
  ReviewSession,
  type AddComment,
  type CreateReviewSession,
} from './shared/schemas.ts';
import { firstEvent, normalize } from './shared/sse.ts';

const headers = {
  authorization: `Bearer ${token}`,
  'content-type': 'application/json',
};

async function call<T>(
  schema: z.ZodType<T>,
  method: string,
  path: string,
  body?: unknown,
) {
  const res = await fetch(baseUrl + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  return {
    status: res.status,
    body: res.ok ? schema.parse(json) : ErrorBody.parse(json),
  };
}

const createReviewSession = (input: CreateReviewSession) =>
  call(ReviewSession, 'POST', '/api/review-sessions', input);
const getReviewSession = (id: string) =>
  call(ReviewSession, 'GET', `/api/review-sessions/${id}`);
const addComment = (id: string, input: AddComment) =>
  call(Comment, 'POST', `/api/review-sessions/${id}/comments`, input);

let ready!: () => void;
const listening = new Promise<void>((resolve) => (ready = resolve));
const event = firstEvent(`${baseUrl}/api/events`, headers, ready);
await listening;

const created = await createReviewSession({
  workingDirectories: ['/repo/a', '/repo/b'],
  title: 'Example',
});
if ('error' in created.body) throw new Error(created.body.error);
const id = created.body.id;
const added = await addComment(id, {
  path: 'src/a.ts',
  startLine: 3,
  endLine: 4,
  body: 'Rename this.',
});
const invalid = await addComment(id, {
  path: 'src/a.ts',
  startLine: 5,
  endLine: 2,
  body: '',
});
const fetched = await getReviewSession(id);
const missing = await getReviewSession('nope');

console.log(
  JSON.stringify(
    normalize({
      created,
      added,
      invalid,
      fetched,
      missing,
      event: await event,
    }),
    null,
    2,
  ),
);
```

</details>

##### Hono

<details>
<summary><code>server/hono/server.ts</code> (60 lines)</summary>

[Source](0006-review-server-libraries/server/hono/server.ts)

```ts
import { serve } from '@hono/node-server';
import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import * as z from 'zod';
import { checkRequest, port } from './shared/config.ts';
import { AddComment, CreateReviewSession } from './shared/schemas.ts';
import { Store } from './shared/store.ts';

const store = new Store();

const json = <S extends z.ZodType>(schema: S) =>
  sValidator('json', schema, (result, c) => {
    if (!result.success)
      return c.json(
        {
          error: z.prettifyError(
            new z.ZodError(result.error as z.core.$ZodIssue[]),
          ),
        },
        400,
      );
  });

const app = new Hono()
  .use('/api/*', async (c, next) => {
    const denied = checkRequest(
      c.req.header('host'),
      c.req.header('authorization'),
    );
    if (denied) return c.json({ error: denied.error }, denied.status);
    await next();
  })
  .get('/api/health', (c) => c.json({ ok: true }))
  .get('/api/events', (c) =>
    streamSSE(c, async (stream) => {
      const stop = store.onComment((comment) =>
        stream.writeSSE({
          event: 'comment-added',
          data: JSON.stringify(comment),
        }),
      );
      await new Promise<void>((resolve) => stream.onAbort(resolve));
      stop();
    }),
  )
  .post('/api/review-sessions', json(CreateReviewSession), (c) =>
    c.json(store.createReviewSession(c.req.valid('json')), 201),
  )
  .get('/api/review-sessions/:id', (c) => {
    const session = store.getReviewSession(c.req.param('id'));
    return session
      ? c.json(session, 200)
      : c.json({ error: 'Session not found' }, 404);
  })
  .post('/api/review-sessions/:id/comments', json(AddComment), (c) => {
    const comment = store.addComment(c.req.param('id'), c.req.valid('json'));
    return comment
      ? c.json(comment, 201)
      : c.json({ error: 'Session not found' }, 404);
  });

export type App = typeof app;

if (import.meta.main) serve({ fetch: app.fetch, port, hostname: '127.0.0.1' });
```

</details>

`hc` types each route from the chain of `.get` and `.post` calls, which Hono's
docs suggest as the simple way to keep the routes in `typeof app`:

<details>
<summary><code>server/hono/client.ts</code> (56 lines)</summary>

[Source](0006-review-server-libraries/server/hono/client.ts)

```ts
import { hc } from 'hono/client';
import type { App } from './server.ts';
import { baseUrl, token } from './shared/config.ts';
import { firstEvent, normalize } from './shared/sse.ts';

const headers = { authorization: `Bearer ${token}` };
const client = hc<App>(baseUrl, { headers });

const result = async <R extends { status: number; json(): Promise<unknown> }>(
  res: R,
) => ({
  status: res.status,
  body: (await res.json()) as Awaited<ReturnType<R['json']>>,
});

let ready!: () => void;
const listening = new Promise<void>((resolve) => (ready = resolve));
const event = firstEvent(`${baseUrl}/api/events`, headers, ready);
await listening;

const created = await result(
  await client.api['review-sessions'].$post({
    json: { workingDirectories: ['/repo/a', '/repo/b'], title: 'Example' },
  }),
);
if ('error' in created.body) throw new Error(created.body.error);
const id = created.body.id;
const comments = client.api['review-sessions'][':id'].comments;
const added = await result(
  await comments.$post({
    param: { id },
    json: { path: 'src/a.ts', startLine: 3, endLine: 4, body: 'Rename this.' },
  }),
);
const invalid = await result(
  await comments.$post({
    param: { id },
    json: { path: 'src/a.ts', startLine: 5, endLine: 2, body: '' },
  }),
);
const fetched = await result(
  await client.api['review-sessions'][':id'].$get({ param: { id } }),
);
const missing = await result(
  await client.api['review-sessions'][':id'].$get({ param: { id: 'nope' } }),
);

console.log(
  JSON.stringify(
    normalize({
      created,
      added,
      invalid,
      fetched,
      missing,
      event: await event,
    }),
    null,
    2,
  ),
);
```

</details>

##### Fastify

<details>
<summary><code>server/fastify/server.ts</code> (80 lines)</summary>

[Source](0006-review-server-libraries/server/fastify/server.ts)

```ts
import Fastify from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import * as z from 'zod';
import { checkRequest, port } from './shared/config.ts';
import {
  AddComment,
  Comment,
  CreateReviewSession,
  ErrorBody,
  ReviewSession,
} from './shared/schemas.ts';
import { Store } from './shared/store.ts';

const store = new Store();
const app = Fastify().withTypeProvider<ZodTypeProvider>();
app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

app.setErrorHandler((error, _req, reply) => {
  if (hasZodFastifySchemaValidationErrors(error))
    return reply.code(400).send({ error: error.message });
  throw error;
});

app.addHook('onRequest', async (req, reply) => {
  const denied = checkRequest(req.headers.host, req.headers.authorization);
  if (denied) return reply.code(denied.status).send({ error: denied.error });
});

app.get('/api/health', () => ({ ok: true }));

app.get('/api/events', (req, reply) => {
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
  });
  reply.raw.write(': connected\n\n');
  const stop = store.onComment((c) =>
    reply.raw.write(`event: comment-added\ndata: ${JSON.stringify(c)}\n\n`),
  );
  req.raw.on('close', stop);
  return reply.hijack();
});

app.post(
  '/api/review-sessions',
  { schema: { body: CreateReviewSession, response: { 201: ReviewSession } } },
  (req, reply) => {
    reply.code(201).send(store.createReviewSession(req.body));
  },
);

app.get(
  '/api/review-sessions/:id',
  {
    schema: {
      params: z.object({ id: z.string() }),
      response: { 200: ReviewSession, 404: ErrorBody },
    },
  },
  (req, reply) => {
    const session = store.getReviewSession(req.params.id);
    if (session) reply.send(session);
    else reply.code(404).send({ error: 'Session not found' });
  },
);

app.post(
  '/api/review-sessions/:id/comments',
  {
    schema: {
      params: z.object({ id: z.string() }),
      body: AddComment,
      response: { 201: Comment, 404: ErrorBody },
    },
  },
  (req, reply) => {
    const comment = store.addComment(req.params.id, req.body);
    if (comment) reply.code(201).send(comment);
    else reply.code(404).send({ error: 'Session not found' });
  },
);

await app.listen({ port, host: '127.0.0.1' });
```

</details>

##### Express

<details>
<summary><code>server/express/server.ts</code> (53 lines)</summary>

[Source](0006-review-server-libraries/server/express/server.ts)

```ts
import express, { type Response } from 'express';
import * as z from 'zod';
import { checkRequest, port } from './shared/config.ts';
import { AddComment, CreateReviewSession } from './shared/schemas.ts';
import { Store } from './shared/store.ts';

const store = new Store();
const app = express();
app.use(express.json());

function parse<T>(
  schema: z.ZodType<T>,
  value: unknown,
  res: Response,
): T | undefined {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  res.status(400).json({ error: z.prettifyError(result.error) });
}

app.use('/api', (req, res, next) => {
  const denied = checkRequest(req.headers.host, req.headers.authorization);
  if (denied) res.status(denied.status).json({ error: denied.error });
  else next();
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
  });
  res.write(': connected\n\n');
  const stop = store.onComment((c) =>
    res.write(`event: comment-added\ndata: ${JSON.stringify(c)}\n\n`),
  );
  req.on('close', stop);
});

app.post('/api/review-sessions', (req, res) => {
  const input = parse(CreateReviewSession, req.body, res);
  if (input) res.status(201).json(store.createReviewSession(input));
});

app.get('/api/review-sessions/:id', (req, res) => {
  const session = store.getReviewSession(req.params.id);
  if (session) res.json(session);
  else res.status(404).json({ error: 'Session not found' });
});

app.post('/api/review-sessions/:id/comments', (req, res) => {
  const input = parse(AddComment, req.body, res);
  if (!input) return;
  const comment = store.addComment(req.params.id, input);
  if (comment) res.status(201).json(comment);
  else res.status(404).json({ error: 'Session not found' });
});

app.listen(port, '127.0.0.1');
```

</details>

##### h3

<details>
<summary><code>server/h3/server.ts</code> (54 lines)</summary>

[Source](0006-review-server-libraries/server/h3/server.ts)

```ts
import { EventStream, H3, HTTPError, readValidatedBody, serve } from 'h3';
import * as z from 'zod';
import { checkRequest, port } from './shared/config.ts';
import { AddComment, CreateReviewSession } from './shared/schemas.ts';
import { Store } from './shared/store.ts';

const store = new Store();

const onError = (result: { issues: readonly unknown[] }) => ({
  status: 400,
  message: z.prettifyError(new z.ZodError(result.issues as z.core.$ZodIssue[])),
});

const app = new H3({
  onError: (error) =>
    Response.json({ error: error.message }, { status: error.status }),
})
  .use('/api/**', (event) => {
    const denied = checkRequest(
      event.req.headers.get('host'),
      event.req.headers.get('authorization'),
    );
    if (denied)
      throw new HTTPError({ status: denied.status, message: denied.error });
  })
  .get('/api/health', () => ({ ok: true }))
  .get('/api/events', (event) => {
    const stream = new EventStream(event);
    void stream.pushComment('connected');
    const stop = store.onComment((c) =>
      stream.push({ event: 'comment-added', data: JSON.stringify(c) }),
    );
    stream.onClosed(stop);
    return stream;
  })
  .post('/api/review-sessions', async (event) => {
    const input = await readValidatedBody(event, CreateReviewSession, {
      onError,
    });
    event.res.status = 201;
    return store.createReviewSession(input);
  })
  .get('/api/review-sessions/:id', (event) => {
    const session = store.getReviewSession(event.context.params!.id!);
    if (!session)
      throw new HTTPError({ status: 404, message: 'Session not found' });
    return session;
  })
  .post('/api/review-sessions/:id/comments', async (event) => {
    const input = await readValidatedBody(event, AddComment, { onError });
    const comment = store.addComment(event.context.params!.id!, input);
    if (!comment)
      throw new HTTPError({ status: 404, message: 'Session not found' });
    event.res.status = 201;
    return comment;
  });

serve(app, { port, hostname: '127.0.0.1', silent: true });
```

</details>

`event.context.params` isn't typed from the route path, so the example asserts
that `id` is present.

##### Elysia

<details>
<summary><code>server/elysia/server.ts</code> (78 lines)</summary>

[Source](0006-review-server-libraries/server/elysia/server.ts)

```ts
import { node } from '@elysia/node';
import { Elysia, sse } from 'elysia';
import * as z from 'zod';
import { checkRequest, port } from './shared/config.ts';
import {
  AddComment,
  Comment,
  CreateReviewSession,
  ErrorBody,
  ReviewSession,
} from './shared/schemas.ts';
import { Store } from './shared/store.ts';

const store = new Store();

const app = new Elysia({ adapter: node() })
  .onError(({ code, error, status }) => {
    if (code === 'VALIDATION') return status(400, { error: error.message });
  })
  .onRequest(({ request, status }) => {
    const denied = checkRequest(
      request.headers.get('host'),
      request.headers.get('authorization'),
    );
    if (denied) return status(denied.status, { error: denied.error });
  })
  .get('/api/health', () => ({ ok: true }))
  .get('/api/events', async function* ({ request }) {
    const queue: Comment[] = [];
    let wake = () => {};
    const stop = store.onComment((c) => {
      queue.push(c);
      wake();
    });
    request.signal.addEventListener('abort', () => wake());
    try {
      yield sse({ event: 'connected', data: '' });
      while (!request.signal.aborted) {
        const comment = queue.shift();
        if (comment) yield sse({ event: 'comment-added', data: comment });
        else await new Promise<void>((resolve) => (wake = resolve));
      }
    } finally {
      stop();
    }
  })
  .post(
    '/api/review-sessions',
    ({ body, status }) => status(201, store.createReviewSession(body)),
    {
      body: CreateReviewSession,
      response: { 201: ReviewSession },
    },
  )
  .get(
    '/api/review-sessions/:id',
    ({ params, status }) =>
      store.getReviewSession(params.id) ??
      status(404, { error: 'Session not found' }),
    {
      params: z.object({ id: z.string() }),
      response: { 200: ReviewSession, 404: ErrorBody },
    },
  )
  .post(
    '/api/review-sessions/:id/comments',
    ({ params, body, status }) => {
      const comment = store.addComment(params.id, body);
      return comment
        ? status(201, comment)
        : status(404, { error: 'Session not found' });
    },
    {
      params: z.object({ id: z.string() }),
      body: AddComment,
      response: { 201: Comment, 404: ErrorBody },
    },
  );

export type App = typeof app;

if (import.meta.main) app.listen({ port, hostname: '127.0.0.1' });
```

</details>

<details>
<summary><code>server/elysia/client.ts</code> (69 lines)</summary>

[Source](0006-review-server-libraries/server/elysia/client.ts)

```ts
import { treaty } from '@elysiajs/eden';
import type { App } from './server.ts';
import { baseUrl, token } from './shared/config.ts';
import { notAny } from './shared/probe.ts';
import { normalize } from './shared/sse.ts';

const client = treaty<App>(baseUrl, {
  headers: { authorization: `Bearer ${token}` },
});

const result = <
  T extends { status: number; data: unknown; error: { value: unknown } | null },
>(
  r: T,
) => ({
  status: r.status,
  body: r.error ? r.error.value : r.data,
});

// Leaving the loop doesn't close the stream, so abort it.
const stream = new AbortController();
const events = await client.api.events.get({
  fetch: { signal: stream.signal },
});
if (events.error) throw new Error(`events: HTTP ${events.status}`);
const event = (async () => {
  for await (const message of events.data) {
    if (message.event !== 'comment-added') continue;
    stream.abort();
    return message;
  }
})();

const created = await client.api['review-sessions'].post({
  workingDirectories: ['/repo/a', '/repo/b'],
  title: 'Example',
});
if (created.error) throw new Error(JSON.stringify(created.error.value));
const id = notAny(created.data).id;
const session = client.api['review-sessions']({ id });
const added = result(
  await session.comments.post({
    path: 'src/a.ts',
    startLine: 3,
    endLine: 4,
    body: 'Rename this.',
  }),
);
const invalid = result(
  await session.comments.post({
    path: 'src/a.ts',
    startLine: 5,
    endLine: 2,
    body: '',
  }),
);
const fetched = result(await session.get());
const missing = result(
  await client.api['review-sessions']({ id: 'nope' }).get(),
);

console.log(
  JSON.stringify(
    normalize({
      created: result(created),
      added,
      invalid,
      fetched,
      missing,
      event: await event,
    }),
    null,
    2,
  ),
);
```

</details>

##### tRPC

<details>
<summary><code>server/trpc/server.ts</code> (77 lines)</summary>

[Source](0006-review-server-libraries/server/trpc/server.ts)

```ts
import { initTRPC, TRPCError } from '@trpc/server';
import { createHTTPServer } from '@trpc/server/adapters/standalone';
import * as z from 'zod';
import { checkRequest, port } from './shared/config.ts';
import {
  AddComment,
  CreateReviewSession,
  type Comment,
} from './shared/schemas.ts';
import { Store } from './shared/store.ts';

const store = new Store();

const t = initTRPC.create({
  errorFormatter: ({ shape, error }) => ({
    ...shape,
    message:
      error.cause instanceof z.ZodError
        ? z.prettifyError(error.cause)
        : shape.message,
  }),
});

const notFound = () =>
  new TRPCError({ code: 'NOT_FOUND', message: 'Session not found' });

export const router = t.router({
  health: t.procedure.query(() => ({ ok: true })),
  events: t.procedure.subscription(async function* ({ signal }) {
    const queue: Comment[] = [];
    let wake = () => {};
    const stop = store.onComment((c) => {
      queue.push(c);
      wake();
    });
    signal?.addEventListener('abort', () => wake());
    try {
      while (!signal?.aborted) {
        const comment = queue.shift();
        if (comment) yield comment;
        else await new Promise<void>((resolve) => (wake = resolve));
      }
    } finally {
      stop();
    }
  }),
  reviewSessions: {
    create: t.procedure
      .input(CreateReviewSession)
      .mutation(({ input }) => store.createReviewSession(input)),
    get: t.procedure
      .input(z.object({ id: z.string() }))
      .query(
        ({ input }) =>
          store.getReviewSession(input.id) ?? Promise.reject(notFound()),
      ),
    addComment: t.procedure
      .input(z.object({ id: z.string(), comment: AddComment }))
      .mutation(
        ({ input }) =>
          store.addComment(input.id, input.comment) ??
          Promise.reject(notFound()),
      ),
  },
});

export type Router = typeof router;

if (import.meta.main) {
  createHTTPServer({
    router,
    basePath: '/api/',
    createContext: ({ req }) => {
      const denied = checkRequest(req.headers.host, req.headers.authorization);
      if (denied)
        throw new TRPCError({
          code: denied.status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN',
          message: denied.error,
        });
      return {};
    },
  }).listen(port, '127.0.0.1');
}
```

</details>

<details>
<summary><code>server/trpc/client.ts</code> (91 lines)</summary>

[Source](0006-review-server-libraries/server/trpc/client.ts)

```ts
import {
  createTRPCClient,
  httpLink,
  httpSubscriptionLink,
  splitLink,
  TRPCClientError,
} from '@trpc/client';
import { EventSource } from 'eventsource';
import type { Router } from './server.ts';
import { baseUrl, token } from './shared/config.ts';
import { notAny } from './shared/probe.ts';
import { normalize } from './shared/sse.ts';

const headers = { authorization: `Bearer ${token}` };
const url = `${baseUrl}/api`;
const client = createTRPCClient<Router>({
  links: [
    splitLink({
      condition: (op) => op.type === 'subscription',
      true: httpSubscriptionLink({
        url,
        EventSource,
        eventSourceOptions: {
          fetch: (input, init) =>
            fetch(input, { ...init, headers: { ...init.headers, ...headers } }),
        },
      }),
      false: httpLink({ url, headers }),
    }),
  ],
});

async function result<T>(call: Promise<T>) {
  try {
    return { status: 200, body: await call };
  } catch (error) {
    if (!(error instanceof TRPCClientError)) throw error;
    return {
      status: error.data?.httpStatus as number,
      body: { error: error.message },
    };
  }
}

let ready!: () => void;
const listening = new Promise<void>((resolve) => (ready = resolve));
const event = new Promise((resolve) => {
  const sub = client.events.subscribe(undefined, {
    onStarted: ready,
    onData: (data) => {
      resolve({ event: 'comment-added', data });
      sub.unsubscribe();
    },
  });
});
await listening;

const created = await client.reviewSessions.create.mutate({
  workingDirectories: ['/repo/a', '/repo/b'],
  title: 'Example',
});
const id = notAny(created).id;
const added = await result(
  client.reviewSessions.addComment.mutate({
    id,
    comment: {
      path: 'src/a.ts',
      startLine: 3,
      endLine: 4,
      body: 'Rename this.',
    },
  }),
);
const invalid = await result(
  client.reviewSessions.addComment.mutate({
    id,
    comment: { path: 'src/a.ts', startLine: 5, endLine: 2, body: '' },
  }),
);
const fetched = await result(client.reviewSessions.get.query({ id }));
const missing = await result(client.reviewSessions.get.query({ id: 'nope' }));

console.log(
  JSON.stringify(
    normalize({
      created: { status: 200, body: created },
      added,
      invalid,
      fetched,
      missing,
      event: await event,
    }),
    null,
    2,
  ),
);
```

</details>

##### oRPC

<details>
<summary><code>server/orpc/contract.ts</code> (39 lines)</summary>

[Source](0006-review-server-libraries/server/orpc/contract.ts)

```ts
// The API contract, imported by the server and by clients such as the CLI.
import { eventIterator, oc } from '@orpc/contract';
import * as z from 'zod';
import {
  AddComment,
  Comment,
  CreateReviewSession,
  ReviewSession,
} from './shared/schemas.ts';

const NOT_FOUND = { message: 'Session not found' };
const byId = z.object({ id: z.string() });

export const contract = {
  health: oc
    .route({ method: 'GET', path: '/health' })
    .output(z.object({ ok: z.boolean() })),
  events: oc
    .route({ method: 'GET', path: '/events' })
    .output(eventIterator(Comment)),
  reviewSessions: {
    create: oc
      .route({ method: 'POST', path: '/review-sessions', successStatus: 201 })
      .input(CreateReviewSession)
      .output(ReviewSession),
    get: oc
      .route({ method: 'GET', path: '/review-sessions/{id}' })
      .errors({ NOT_FOUND })
      .input(byId)
      .output(ReviewSession),
    addComment: oc
      .route({
        method: 'POST',
        path: '/review-sessions/{id}/comments',
        successStatus: 201,
        inputStructure: 'detailed',
      })
      .errors({ NOT_FOUND })
      .input(z.object({ params: byId, body: AddComment }))
      .output(Comment),
  },
};
```

</details>

The server implements the contract, so a handler can't drift from it:

<details>
<summary><code>server/orpc/server.ts</code> (78 lines)</summary>

[Source](0006-review-server-libraries/server/orpc/server.ts)

```ts
import { createServer, type IncomingHttpHeaders } from 'node:http';
import { OpenAPIHandler } from '@orpc/openapi/node';
import {
  EventPublisher,
  implement,
  ORPCError,
  ValidationError,
} from '@orpc/server';
import * as z from 'zod';
import { contract } from './contract.ts';
import { checkRequest, port } from './shared/config.ts';
import type { Comment } from './shared/schemas.ts';
import { Store } from './shared/store.ts';

const store = new Store();
const published = new EventPublisher<{ comment: Comment }>();
store.onComment((c) => published.publish('comment', c));

const os = implement(contract).$context<{ headers: IncomingHttpHeaders }>();

const authorized = os.middleware(({ context, next }) => {
  const denied = checkRequest(
    context.headers.host,
    context.headers.authorization,
  );
  if (denied)
    throw new ORPCError(denied.status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN', {
      message: denied.error,
    });
  return next();
});

const router = os.use(authorized).router({
  health: os.health.handler(() => ({ ok: true })),
  events: os.events.handler(({ signal }) =>
    published.subscribe('comment', { signal }),
  ),
  reviewSessions: {
    create: os.reviewSessions.create.handler(({ input }) =>
      store.createReviewSession(input),
    ),
    get: os.reviewSessions.get.handler(({ input, errors }) => {
      const session = store.getReviewSession(input.id);
      if (!session) throw errors.NOT_FOUND();
      return session;
    }),
    addComment: os.reviewSessions.addComment.handler(({ input, errors }) => {
      const comment = store.addComment(input.params.id, input.body);
      if (!comment) throw errors.NOT_FOUND();
      return comment;
    }),
  },
});

const handler = new OpenAPIHandler(router, {
  clientInterceptors: [
    async ({ next }) => {
      try {
        return await next();
      } catch (error) {
        if (
          error instanceof ORPCError &&
          error.code === 'BAD_REQUEST' &&
          error.cause instanceof ValidationError
        ) {
          throw new ORPCError('BAD_REQUEST', {
            message: z.prettifyError(
              new z.ZodError(error.cause.issues as z.core.$ZodIssue[]),
            ),
          });
        }
        throw error;
      }
    },
  ],
});

createServer(async (req, res) => {
  const { matched } = await handler.handle(req, res, {
    prefix: '/api',
    context: { headers: req.headers },
  });
  if (!matched) res.writeHead(404).end();
}).listen(port, '127.0.0.1');
```

</details>

<details>
<summary><code>server/orpc/client.ts</code> (60 lines)</summary>

[Source](0006-review-server-libraries/server/orpc/client.ts)

```ts
import { createORPCClient, ORPCError } from '@orpc/client';
import type { ContractRouterClient } from '@orpc/contract';
import type { JsonifiedClient } from '@orpc/openapi-client';
import { OpenAPILink } from '@orpc/openapi-client/fetch';
import { contract } from './contract.ts';
import { baseUrl, token } from './shared/config.ts';
import { notAny } from './shared/probe.ts';
import { normalize } from './shared/sse.ts';

const link = new OpenAPILink(contract, {
  url: `${baseUrl}/api`,
  headers: { authorization: `Bearer ${token}` },
});
const client: JsonifiedClient<ContractRouterClient<typeof contract>> =
  createORPCClient(link);

async function result<T>(call: Promise<T>, status = 200) {
  try {
    return { status, body: await call };
  } catch (error) {
    if (!(error instanceof ORPCError)) throw error;
    return { status: error.status, body: { error: error.message } };
  }
}

const events = await client.events();
const event = (async () => {
  for await (const data of events) return { event: 'comment-added', data };
})();

const created = await client.reviewSessions.create({
  workingDirectories: ['/repo/a', '/repo/b'],
  title: 'Example',
});
const id = notAny(created).id;
const added = await result(
  client.reviewSessions.addComment({
    params: { id },
    body: { path: 'src/a.ts', startLine: 3, endLine: 4, body: 'Rename this.' },
  }),
  201,
);
const invalid = await result(
  client.reviewSessions.addComment({
    params: { id },
    body: { path: 'src/a.ts', startLine: 5, endLine: 2, body: '' },
  }),
);
const fetched = await result(client.reviewSessions.get({ id }));
const missing = await result(client.reviewSessions.get({ id: 'nope' }));

console.log(
  JSON.stringify(
    normalize({
      created: { status: 201, body: created },
      added,
      invalid,
      fetched,
      missing,
      event: await event,
    }),
    null,
    2,
  ),
);
```

</details>

### Validation libraries

The same schemas were written with each library: creating a session, and adding
a comment that is either a range comment (`path`, `startLine`, `endLine`,
`body`, with the check across fields) or an overall comment (`body` only), told
apart by `kind`. Each `schemas.ts` exports the schemas, their inferred types,
and a `check` function that returns the value or a message.

[`validate/harness/types.ts`](0006-review-server-libraries/validate/harness/types.ts)
fails to compile unless the inferred types equal hand-written ones, and
[`run.ts`](0006-review-server-libraries/validate/harness/run.ts) prints the
messages for four invalid inputs and times `check` on valid and invalid input,
the median of five half-second rounds. Bundle size is an esbuild 0.28.2 bundle
of `check` for the browser, minified, then gzipped, in case the review UI shares
the schemas.

| Library       | Version | `schemas.ts` lines | Install      |         Browser bundle (gzipped) | Standard Schema                  | Cross-field check runs alongside field errors | JSON Schema                                                     | Valid parses/s | Invalid parses/s | Load time |
| ------------- | ------- | -----------------: | ------------ | -------------------------------: | -------------------------------- | --------------------------------------------- | --------------------------------------------------------------- | -------------: | ---------------: | --------: |
| Zod           | 4.6.7   |                 33 | 8,256 KB, 1  |                          27.3 KB | Yes                              | Yes                                           | `z.toJSONSchema`, leaves out the check                          |           780k |              19k |    487 ms |
| Zod Mini      | 4.6.7   |                 39 | same package | 9.0 KB (7.9 KB without messages) | Yes                              | Yes                                           | `z.toJSONSchema`, leaves out the check                          |           373k |              17k |    461 ms |
| Valibot       | 1.5.0   |                 39 | 2,028 KB, 2  |                           2.8 KB | Yes                              | Yes, with `partialCheck`                      | `@valibot/to-json-schema` 1.8.0, throws on the check by default |           452k |             124k |    241 ms |
| ArkType       | 2.2.8   |                 29 | 1,712 KB, 4  |                          47.5 KB | Yes                              | No                                            | `toJsonSchema()`, throws on the check by default                |           312k |              23k |  1,307 ms |
| TypeBox       | 1.3.37  |                 35 | 6,104 KB, 1  |                          41.7 KB | No                               | No                                            | The schema is JSON Schema; the check isn't in it                |        17,952k |              18k |  1,189 ms |
| Effect Schema | 4.0.4   |                 35 | 56,372 KB, 1 |                          79.8 KB | With `Schema.toStandardSchemaV1` | No                                            | `Schema.toJsonSchemaDocument`, leaves out the check             |           336k |              28k |  1,309 ms |

- Every library's inferred types matched the hand-written ones, and every
  example type-checked and ran under type stripping. Valibot's size includes
  `@valibot/to-json-schema`.
- **Load time** is `node import.ts`, which imports the schemas and checks one
  value, against 189 ms for an empty file. With Node's compile cache, Zod took
  306 ms, Valibot 104 ms, ArkType 1,135 ms, TypeBox 1,003 ms, and Effect 1,044
  ms, against 86 ms for an empty file. TypeBox compiles its validator when the
  module loads; ArkType parses its string definitions.
- **Invalid parses/s** includes formatting the message, which dominates for
  every library but Valibot.
- **Zod Mini** printed "Invalid input" for every issue until English messages
  were loaded with `z.config(en())` from `zod/locales`. Loading them through
  `z.locales.en()` instead pulled every locale into the bundle (47 KB gzipped)
  ([Zod Mini](https://zod.dev/packages/mini)).
- **Code generation:** Zod, ArkType, and TypeBox compile validators with
  `new Function` where it's allowed and fall back where it isn't, which matters
  if the review UI sets a Content Security Policy without `unsafe-eval`. The
  fallbacks weren't tested.
- **TypeBox 1.x** doesn't implement Standard Schema, so frameworks that accept
  Standard Schema can't take its schemas directly. Its schemas are plain JSON
  Schema objects. Fastify's `@fastify/type-provider-typebox` 6.3.0 uses TypeBox
  1.x; Elysia's built-in `t` uses the older `@sinclair/typebox` 0.34.
- **Effect Schema** is part of `effect`, and its install is the whole library.

Sources: [Zod JSON Schema](https://zod.dev/json-schema),
[Valibot pipelines](https://valibot.dev/guides/pipelines/),
[`@valibot/to-json-schema`](https://github.com/open-circle/valibot/tree/main/packages/to-json-schema),
[ArkType](https://arktype.io/docs/intro/setup),
[TypeBox](https://sinclairzx81.github.io/typebox/), and
[Effect Schema](https://effect.website/docs/schema/introduction/).

#### Error messages

For `{ kind: "range", path: "src/a.ts", startLine: 5, endLine: 2, body: "" }`,
which fails a field check and the check across fields:

| Library  | Message                                                                                                                                                           |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zod      | `✖ Too small: expected string to have >=1 characters → at body`, `✖ endLine must not be before startLine → at endLine`                                            |
| Zod Mini | The same as Zod, with English messages loaded                                                                                                                     |
| Valibot  | `× Invalid length: Expected >=1 but received 0 → at body`, `× endLine must not be before startLine → at endLine`                                                  |
| ArkType  | `body must be non-empty`                                                                                                                                          |
| TypeBox  | `/body must not have fewer than 1 characters`, `/kind must be equal to constant`, `/body must not have fewer than 1 characters`, `/ must match a schema in anyOf` |
| Effect   | `Expected a value with a length of at least 1 at ["body"]`                                                                                                        |

ArkType, TypeBox, and Effect run the check across fields only once the object's
own fields are valid, so it's reported only after the empty body is fixed.
Valibot's `partialCheck` runs when the fields it names are valid. For an unknown
`kind`, Zod said `Invalid discriminator value. Expected 'range' | 'overall'`,
Valibot `Expected ("range" | "overall") but received "file"`, ArkType
`kind must be "range" or "overall" (was "file")`, TypeBox listed one error per
union member, and Effect printed the shape of both members. TypeBox's
`Type.Union` isn't discriminated, so it reports every member's errors.

#### Schemas

##### Zod

<details>
<summary><code>validate/zod/schemas.ts</code> (33 lines)</summary>

[Source](0006-review-server-libraries/validate/zod/schemas.ts)

```ts
import * as z from 'zod';

export const CreateReviewSession = z.object({
  workingDirectories: z.array(z.string().startsWith('/')).min(1),
  title: z.string().max(200).optional(),
});

const RangeComment = z
  .object({
    kind: z.literal('range'),
    path: z.string().min(1),
    startLine: z.int().min(1),
    endLine: z.int().min(1),
    body: z.string().min(1),
  })
  .refine((c) => c.endLine >= c.startLine, {
    message: 'endLine must not be before startLine',
    path: ['endLine'],
  });

const OverallComment = z.object({
  kind: z.literal('overall'),
  body: z.string().min(1),
});

export const AddComment = z.discriminatedUnion('kind', [
  RangeComment,
  OverallComment,
]);

export type CreateReviewSession = z.infer<typeof CreateReviewSession>;
export type AddComment = z.infer<typeof AddComment>;

export function check(input: unknown) {
  const result = AddComment.safeParse(input);
  return result.success
    ? { ok: true as const, value: result.data }
    : { ok: false as const, message: z.prettifyError(result.error) };
}
```

</details>

##### Zod Mini

<details>
<summary><code>validate/zod-mini/schemas.ts</code> (39 lines)</summary>

[Source](0006-review-server-libraries/validate/zod-mini/schemas.ts)

```ts
import { en } from 'zod/locales';
import * as z from 'zod/mini';

// zod/mini doesn't load error messages by default.
z.config(en());

export const CreateReviewSession = z.object({
  workingDirectories: z
    .array(z.string().check(z.startsWith('/')))
    .check(z.minLength(1)),
  title: z.optional(z.string().check(z.maxLength(200))),
});

const RangeComment = z
  .object({
    kind: z.literal('range'),
    path: z.string().check(z.minLength(1)),
    startLine: z.int().check(z.gte(1)),
    endLine: z.int().check(z.gte(1)),
    body: z.string().check(z.minLength(1)),
  })
  .check(
    z.refine((c) => c.endLine >= c.startLine, {
      message: 'endLine must not be before startLine',
      path: ['endLine'],
    }),
  );

const OverallComment = z.object({
  kind: z.literal('overall'),
  body: z.string().check(z.minLength(1)),
});

export const AddComment = z.discriminatedUnion('kind', [
  RangeComment,
  OverallComment,
]);

export type CreateReviewSession = z.infer<typeof CreateReviewSession>;
export type AddComment = z.infer<typeof AddComment>;

export function check(input: unknown) {
  const result = z.safeParse(AddComment, input);
  return result.success
    ? { ok: true as const, value: result.data }
    : { ok: false as const, message: z.prettifyError(result.error) };
}
```

</details>

##### Valibot

<details>
<summary><code>validate/valibot/schemas.ts</code> (39 lines)</summary>

[Source](0006-review-server-libraries/validate/valibot/schemas.ts)

```ts
import * as v from 'valibot';

export const CreateReviewSession = v.object({
  workingDirectories: v.pipe(
    v.array(v.pipe(v.string(), v.startsWith('/'))),
    v.minLength(1),
  ),
  title: v.optional(v.pipe(v.string(), v.maxLength(200))),
});

const line = v.pipe(v.number(), v.integer(), v.minValue(1));

const RangeComment = v.pipe(
  v.object({
    kind: v.literal('range'),
    path: v.pipe(v.string(), v.minLength(1)),
    startLine: line,
    endLine: line,
    body: v.pipe(v.string(), v.minLength(1)),
  }),
  v.forward(
    v.partialCheck(
      [['startLine'], ['endLine']],
      (c) => c.endLine >= c.startLine,
      'endLine must not be before startLine',
    ),
    ['endLine'],
  ),
);

const OverallComment = v.object({
  kind: v.literal('overall'),
  body: v.pipe(v.string(), v.minLength(1)),
});

export const AddComment = v.variant('kind', [RangeComment, OverallComment]);

export type CreateReviewSession = v.InferOutput<typeof CreateReviewSession>;
export type AddComment = v.InferOutput<typeof AddComment>;

export function check(input: unknown) {
  const result = v.safeParse(AddComment, input);
  return result.success
    ? { ok: true as const, value: result.output }
    : { ok: false as const, message: v.summarize(result.issues) };
}
```

</details>

##### ArkType

<details>
<summary><code>validate/arktype/schemas.ts</code> (29 lines)</summary>

[Source](0006-review-server-libraries/validate/arktype/schemas.ts)

```ts
import { type } from 'arktype';

export const CreateReviewSession = type({
  workingDirectories: type(/^\//).array().atLeastLength(1),
  'title?': 'string <= 200',
});

const RangeComment = type({
  kind: "'range'",
  path: 'string > 0',
  startLine: 'number.integer >= 1',
  endLine: 'number.integer >= 1',
  body: 'string > 0',
}).narrow(
  (c, ctx) =>
    c.endLine >= c.startLine ||
    ctx.reject({
      message: 'endLine must not be before startLine',
      path: ['endLine'],
    }),
);

const OverallComment = type({ kind: "'overall'", body: 'string > 0' });

export const AddComment = RangeComment.or(OverallComment);

export type CreateReviewSession = typeof CreateReviewSession.infer;
export type AddComment = typeof AddComment.infer;

export function check(input: unknown) {
  const out = AddComment(input);
  return out instanceof type.errors
    ? { ok: false as const, message: out.summary }
    : { ok: true as const, value: out };
}
```

</details>

##### TypeBox

<details>
<summary><code>validate/typebox/schemas.ts</code> (35 lines)</summary>

[Source](0006-review-server-libraries/validate/typebox/schemas.ts)

```ts
import Type from 'typebox';
import { Compile } from 'typebox/compile';

export const CreateReviewSession = Type.Object({
  workingDirectories: Type.Array(Type.String({ pattern: '^/' }), {
    minItems: 1,
  }),
  title: Type.Optional(Type.String({ maxLength: 200 })),
});

const RangeComment = Type.Refine(
  Type.Object({
    kind: Type.Literal('range'),
    path: Type.String({ minLength: 1 }),
    startLine: Type.Integer({ minimum: 1 }),
    endLine: Type.Integer({ minimum: 1 }),
    body: Type.String({ minLength: 1 }),
  }),
  (c) => c.endLine >= c.startLine,
  () => 'endLine must not be before startLine',
);

const OverallComment = Type.Object({
  kind: Type.Literal('overall'),
  body: Type.String({ minLength: 1 }),
});

export const AddComment = Type.Union([RangeComment, OverallComment]);

export type CreateReviewSession = Type.Static<typeof CreateReviewSession>;
export type AddComment = Type.Static<typeof AddComment>;

const validator = Compile(AddComment);

export function check(input: unknown) {
  if (validator.Check(input)) return { ok: true as const, value: input };
  const message = validator
    .Errors(input)
    .map((e) => `${e.instancePath || '/'} ${e.message}`)
    .join('\n');
  return { ok: false as const, message };
}
```

</details>

##### Effect Schema

<details>
<summary><code>validate/effect/schemas.ts</code> (35 lines)</summary>

[Source](0006-review-server-libraries/validate/effect/schemas.ts)

```ts
import { Result, Schema } from 'effect';

export const CreateReviewSession = Schema.Struct({
  workingDirectories: Schema.Array(
    Schema.String.check(Schema.isStartingWith('/')),
  ).check(Schema.isMinLength(1)),
  title: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
});

const line = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

const RangeComment = Schema.Struct({
  kind: Schema.Literal('range'),
  path: Schema.NonEmptyString,
  startLine: line,
  endLine: line,
  body: Schema.NonEmptyString,
}).check(
  Schema.makeFilter((c) =>
    c.endLine >= c.startLine
      ? undefined
      : { path: ['endLine'], issue: 'endLine must not be before startLine' },
  ),
);

const OverallComment = Schema.Struct({
  kind: Schema.Literal('overall'),
  body: Schema.NonEmptyString,
});

export const AddComment = Schema.Union([RangeComment, OverallComment]);

export type CreateReviewSession = typeof CreateReviewSession.Type;
export type AddComment = typeof AddComment.Type;

const decode = Schema.decodeUnknownResult(AddComment, { errors: 'all' });

export function check(input: unknown) {
  const result = decode(input);
  return Result.isSuccess(result)
    ? { ok: true as const, value: result.success }
    : { ok: false as const, message: result.failure.message };
}
```

</details>

### SQLite drivers

[`sqlite/workload.ts`](0006-review-server-libraries/sqlite/workload.ts) opens a
database file in WAL mode with `synchronous = normal`, then times three phases:

- **Bulk:** 10,000 comments inserted in one transaction.
- **Single:** 2,000 comments inserted one at a time, each in its own
  transaction, as saving each [comment](../glossary.md#comment) on its own
  would.
- **Read:** 2,000 queries for one session's comments, 120 rows each.

It ran three times per driver, on ext4 on the machine's disk, and the median is
shown. A first run on `/tmp`, which is `tmpfs` here, gave similar bulk and read
times and lower single-insert times, since `tmpfs` doesn't sync to disk.

| Driver            | Version      | SQLite | How it's installed                                                                 | Install       | API               |     Bulk |    Single |     Read |
| ----------------- | ------------ | ------ | ---------------------------------------------------------------------------------- | ------------- | ----------------- | -------: | --------: | -------: |
| `node:sqlite`     | Node 24.21.0 | 3.53.4 | Built into Node                                                                    | Nothing       | Sync              |   141 ms |    293 ms | 1,515 ms |
| better-sqlite3    | 13.0.3       | 3.53.4 | Ships prebuilt binaries for 8 platforms inside the package, with no install script | 30,248 KB, 5  | Sync              |   236 ms |    397 ms | 1,338 ms |
| libsql            | 0.5.29       | 3.45.1 | A prebuilt binary in a package per platform                                        | 19,304 KB, 12 | Sync              |   499 ms |    514 ms | 4,854 ms |
| `@libsql/client`  | 0.18.0       | 3.45.1 | Uses libsql for local files                                                        | 23,552 KB, 22 | Async             | 1,906 ms |    787 ms | 8,338 ms |
| sqlite3           | 6.0.1        | 3.52.0 | An install script downloads a prebuilt binary, or builds it with `node-gyp`        | 16,164 KB, 58 | Async (callbacks) | 1,474 ms |    604 ms | 4,060 ms |
| node-sqlite3-wasm | 0.8.60       | 3.53.4 | WebAssembly, no native code                                                        | 1,316 KB, 1   | Sync              |   206 ms | 18,868 ms | 5,327 ms |

better-sqlite3's size includes `@types/better-sqlite3`. Single-insert times
varied between runs on this disk: a run of `node:sqlite` on Node 26.11.1 took
445 ms for the same phase, against 134 ms bulk and 1,300 ms read.

- **`node:sqlite`** is "Stability: 1.2 - Release candidate" since Node 24.15.0.
  It hasn't needed a flag since 22.13.0 and 23.4.0, and printed no warning on
  24.21.0
  ([Node 24 docs](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)). In
  Node 26 the class is named `Database`, and `DatabaseSync` is a deprecated
  alias for it. Both are synchronous
  ([Node 26 docs](https://nodejs.org/docs/latest-v26.x/api/sqlite.html)). Its
  types return rows as `Record<string, SQLOutputValue>`, so the prototype and
  the examples cast them. It has user-defined functions, sessions and
  changesets, and `backup()`.
- **better-sqlite3** needs no compiler or network access at install for the 8
  platforms it ships, and declares `node >= 22`. `Statement` takes type
  parameters for its arguments
  ([better-sqlite3](https://github.com/WiseLibs/better-sqlite3)).
- **libsql** has better-sqlite3's API, built on Turso's fork of SQLite, which
  reported SQLite 3.45.1. `@libsql/client` adds an async API and remote
  databases ([libsql-js](https://github.com/tursodatabase/libsql-js),
  [libsql-client-ts](https://github.com/tursodatabase/libsql-client-ts)).
- **sqlite3**'s repository was archived
  ([TryGhost/node-sqlite3](https://github.com/TryGhost/node-sqlite3)), with one
  version published in the last year. npm 11.19.0 warned that its install script
  isn't covered by `allowScripts`, and that `prebuild-install` is no longer
  maintained.
- **node-sqlite3-wasm** stayed in `delete` journal mode when asked for WAL, so
  every single insert synced the whole journal. Without WAL, readers and the
  writer block each other ([SQLite WAL](https://www.sqlite.org/wal.html)).
- Bun's `bun:sqlite` only runs on Bun.

### Query layers

Each query layer implements the same store: create a session with its working
directories in one transaction, get a session with its working directories and
comments, and add a comment if the session exists.
[`query/test.ts`](0006-review-server-libraries/query/test.ts) prints the same
result for each. Tables are created from the same
[`schema.sql`](0006-review-server-libraries/query/schema.sql) in every example,
so migrations weren't compared. Reads are 2,000 calls to get a session with 20
comments, in memory, the median of five rounds. Load time is `node import.ts`,
which opens the store.

| Query layer        | Driver         |               `store.ts` lines | Install                                                                         |    Reads | Load time | Row types                                |
| ------------------ | -------------- | -----------------------------: | ------------------------------------------------------------------------------- | -------: | --------: | ---------------------------------------- |
| SQL (baseline)     | `node:sqlite`  |                             92 | Nothing                                                                         |   853 ms |    267 ms | Cast by hand                             |
| Kysely 0.29.6      | `node:sqlite`  |                            146 | 3,448 KB, 1                                                                     | 1,164 ms |    846 ms | From a hand-written `Database` interface |
| Drizzle 0.45.4     | better-sqlite3 |                            136 | 47,100 KB, 6 (17 MB without better-sqlite3)                                     | 3,321 ms |  1,972 ms | From the table definitions               |
| Drizzle 1.0.0-rc.4 | `node:sqlite`  |                            125 | 25,416 KB, 1                                                                    | 3,427 ms |  2,075 ms | From the table definitions               |
| Prisma 7.10.0      | better-sqlite3 | 80, plus 34 in `schema.prisma` | 87,356 KB, 43 for the client and adapter; 346,688 KB, 178 with the `prisma` CLI | 3,201 ms |    637 ms | Generated from `schema.prisma`           |

- **Kysely** has no `node:sqlite` dialect. Its `SqliteDialect` expects
  better-sqlite3's interface, which `node:sqlite` matched with a 15-line
  adapter, since `StatementSync` has `all`, `run`, and `iterate` but no `reader`
  flag ([Kysely dialects](https://kysely.dev/docs/dialects)). It's async even
  over a sync driver.
- **Drizzle**'s stable 0.45.4 has drivers for better-sqlite3, libsql, and
  `bun:sqlite`, but not `node:sqlite`. The 1.0 line adds
  `drizzle-orm/node-sqlite` and a new relational query API (`defineRelations`),
  and its docs install it with the `rc` tag
  ([Drizzle SQLite](https://orm.drizzle.team/docs/get-started-sqlite)).
  1.0.0-rc.4 was published on 2026-06-27; `latest` was still 0.45.4. The example
  was first written against 1.0.0-beta.24 and ran unchanged on rc.4.
- **Prisma** needs `prisma generate` to write a client from `schema.prisma` (5.1
  seconds with `npx` here), which is a build step. With
  `importFileExtension = "ts"`, the generated client ran under type stripping
  and passed `tsc` with `erasableSyntaxOnly`
  ([Prisma generators](https://www.prisma.io/docs/orm/prisma-schema/overview/generators)).
  npm 11.19.0 warned that `@prisma/engines`' postinstall script isn't covered by
  `allowScripts`. The `prisma` package's `latest` tag pointed to 8.0.0-rc.22, so
  `npm install prisma` installs a release candidate.
- Migrations come from `drizzle-kit`, `prisma migrate`, or Kysely's `Migrator`.
  The baseline would need its own, such as SQL files applied in order and
  tracked with `pragma user_version`. None were run.

#### Stores

##### SQL (baseline)

<details>
<summary><code>query/raw/store.ts</code> (92 lines)</summary>

[Source](0006-review-server-libraries/query/raw/store.ts)

```ts
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type {
  AddComment,
  Comment,
  CreateReviewSession,
  ReviewSession,
} from './types.ts';

export class Store {
  private readonly db: DatabaseSync;

  private constructor(db: DatabaseSync) {
    this.db = db;
  }

  static open(file: string): Store {
    const db = new DatabaseSync(file);
    db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
    return new Store(db);
  }

  createReviewSession(input: CreateReviewSession): ReviewSession {
    const id = randomUUID();
    this.db.exec('begin');
    try {
      this.db
        .prepare(
          'insert into review_sessions (id, title, started_at) values (?, ?, ?)',
        )
        .run(id, input.title ?? null, new Date().toISOString());
      const add = this.db.prepare(
        'insert into review_session_working_directories (review_session_id, path) values (?, ?)',
      );
      for (const path of input.workingDirectories) add.run(id, path);
      this.db.exec('commit');
    } catch (error) {
      this.db.exec('rollback');
      throw error;
    }
    return this.getReviewSession(id)!;
  }

  getReviewSession(id: string): ReviewSession | undefined {
    const row = this.db
      .prepare('select id, title, started_at from review_sessions where id = ?')
      .get(id) as
      { id: string; title: string | null; started_at: string } | undefined;
    if (!row) return undefined;
    const dirs = this.db
      .prepare(
        'select path from review_session_working_directories where review_session_id = ? order by path',
      )
      .all(id) as { path: string }[];
    const comments = this.db
      .prepare(
        `select id, review_session_id as reviewSessionId, path, start_line as startLine, end_line as endLine,
         body, created_at as createdAt from comments where review_session_id = ? order by created_at`,
      )
      .all(id) as Comment[];
    return {
      id: row.id,
      title: row.title,
      workingDirectories: dirs.map((d) => d.path),
      startedAt: row.started_at,
      comments: comments.map((c) => ({ ...c })),
    };
  }

  addComment(reviewSessionId: string, input: AddComment): Comment | undefined {
    const exists = this.db
      .prepare('select 1 from review_sessions where id = ?')
      .get(reviewSessionId);
    if (!exists) return undefined;
    const comment: Comment = {
      id: randomUUID(),
      reviewSessionId,
      ...input,
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        `insert into comments (id, review_session_id, path, start_line, end_line, body, created_at)
         values (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        comment.id,
        reviewSessionId,
        comment.path,
        comment.startLine,
        comment.endLine,
        comment.body,
        comment.createdAt,
      );
    return comment;
  }
}
```

</details>

##### Kysely

<details>
<summary><code>query/kysely/store.ts</code> (146 lines)</summary>

[Source](0006-review-server-libraries/query/kysely/store.ts)

```ts
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { Kysely, SqliteDialect } from 'kysely';
import type {
  AddComment,
  Comment,
  CreateReviewSession,
  ReviewSession,
} from './types.ts';

interface Database {
  review_sessions: { id: string; title: string | null; started_at: string };
  review_session_working_directories: {
    review_session_id: string;
    path: string;
  };
  comments: {
    id: string;
    review_session_id: string;
    path: string;
    start_line: number;
    end_line: number;
    body: string;
    created_at: string;
  };
}

// Kysely's SqliteDialect expects better-sqlite3's interface. node:sqlite is close enough with this adapter.
function adapt(db: DatabaseSync) {
  return {
    close: () => db.close(),
    prepare(sql: string) {
      const statement = db.prepare(sql);
      const args = (p: readonly unknown[]) => p as SQLInputValue[];
      return {
        reader: statement.columns().length > 0,
        all: (p: readonly unknown[]) => statement.all(...args(p)),
        run: (p: readonly unknown[]) => statement.run(...args(p)),
        iterate: (p: readonly unknown[]) => statement.iterate(...args(p)),
      };
    },
  };
}

export class Store {
  private readonly db: Kysely<Database>;

  private constructor(db: Kysely<Database>) {
    this.db = db;
  }

  static open(file: string): Store {
    const sqlite = new DatabaseSync(file);
    sqlite.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
    return new Store(
      new Kysely<Database>({
        dialect: new SqliteDialect({ database: adapt(sqlite) }),
      }),
    );
  }

  async createReviewSession(
    input: CreateReviewSession,
  ): Promise<ReviewSession> {
    const id = randomUUID();
    await this.db.transaction().execute(async (tx) => {
      await tx
        .insertInto('review_sessions')
        .values({
          id,
          title: input.title ?? null,
          started_at: new Date().toISOString(),
        })
        .execute();
      await tx
        .insertInto('review_session_working_directories')
        .values(
          input.workingDirectories.map((path) => ({
            review_session_id: id,
            path,
          })),
        )
        .execute();
    });
    return (await this.getReviewSession(id))!;
  }

  async getReviewSession(id: string): Promise<ReviewSession | undefined> {
    const row = await this.db
      .selectFrom('review_sessions')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) return undefined;
    const dirs = await this.db
      .selectFrom('review_session_working_directories')
      .select('path')
      .where('review_session_id', '=', id)
      .orderBy('path')
      .execute();
    const comments = await this.db
      .selectFrom('comments')
      .select([
        'id',
        'review_session_id as reviewSessionId',
        'path',
        'start_line as startLine',
        'end_line as endLine',
        'body',
        'created_at as createdAt',
      ])
      .where('review_session_id', '=', id)
      .orderBy('created_at')
      .execute();
    return {
      id: row.id,
      title: row.title,
      workingDirectories: dirs.map((d) => d.path),
      startedAt: row.started_at,
      comments,
    };
  }

  async addComment(
    reviewSessionId: string,
    input: AddComment,
  ): Promise<Comment | undefined> {
    const exists = await this.db
      .selectFrom('review_sessions')
      .select('id')
      .where('id', '=', reviewSessionId)
      .executeTakeFirst();
    if (!exists) return undefined;
    const comment: Comment = {
      id: randomUUID(),
      reviewSessionId,
      ...input,
      createdAt: new Date().toISOString(),
    };
    await this.db
      .insertInto('comments')
      .values({
        id: comment.id,
        review_session_id: reviewSessionId,
        path: comment.path,
        start_line: comment.startLine,
        end_line: comment.endLine,
        body: comment.body,
        created_at: comment.createdAt,
      })
      .execute();
    return comment;
  }
}
```

</details>

##### Drizzle 0.45.4

<details>
<summary><code>query/drizzle/store.ts</code> (136 lines)</summary>

[Source](0006-review-server-libraries/query/drizzle/store.ts)

```ts
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { asc, eq, relations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';
import type {
  AddComment,
  Comment,
  CreateReviewSession,
  ReviewSession,
} from './types.ts';

const reviewSessions = sqliteTable('review_sessions', {
  id: text().primaryKey(),
  title: text(),
  startedAt: text('started_at').notNull(),
});

const workingDirectories = sqliteTable(
  'review_session_working_directories',
  {
    reviewSessionId: text('review_session_id')
      .notNull()
      .references(() => reviewSessions.id),
    path: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.reviewSessionId, t.path] })],
);

const comments = sqliteTable('comments', {
  id: text().primaryKey(),
  reviewSessionId: text('review_session_id')
    .notNull()
    .references(() => reviewSessions.id),
  path: text().notNull(),
  startLine: integer('start_line').notNull(),
  endLine: integer('end_line').notNull(),
  body: text().notNull(),
  createdAt: text('created_at').notNull(),
});

const reviewSessionRelations = relations(reviewSessions, ({ many }) => ({
  workingDirectories: many(workingDirectories),
  comments: many(comments),
}));
const workingDirectoryRelations = relations(workingDirectories, ({ one }) => ({
  reviewSession: one(reviewSessions, {
    fields: [workingDirectories.reviewSessionId],
    references: [reviewSessions.id],
  }),
}));
const commentRelations = relations(comments, ({ one }) => ({
  reviewSession: one(reviewSessions, {
    fields: [comments.reviewSessionId],
    references: [reviewSessions.id],
  }),
}));

const schema = {
  reviewSessions,
  workingDirectories,
  comments,
  reviewSessionRelations,
  workingDirectoryRelations,
  commentRelations,
};
const open = (client: Database.Database) => drizzle({ client, schema });

export class Store {
  private readonly db: ReturnType<typeof open>;

  private constructor(db: ReturnType<typeof open>) {
    this.db = db;
  }

  static open(file: string): Store {
    const client = new Database(file);
    client.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
    return new Store(open(client));
  }

  createReviewSession(input: CreateReviewSession): ReviewSession {
    const id = randomUUID();
    this.db.transaction((tx) => {
      tx.insert(reviewSessions)
        .values({
          id,
          title: input.title ?? null,
          startedAt: new Date().toISOString(),
        })
        .run();
      tx.insert(workingDirectories)
        .values(
          input.workingDirectories.map((path) => ({
            reviewSessionId: id,
            path,
          })),
        )
        .run();
    });
    return this.getReviewSession(id)!;
  }

  getReviewSession(id: string): ReviewSession | undefined {
    const row = this.db.query.reviewSessions
      .findFirst({
        where: eq(reviewSessions.id, id),
        with: {
          workingDirectories: {
            columns: { path: true },
            orderBy: asc(workingDirectories.path),
          },
          comments: { orderBy: asc(comments.createdAt) },
        },
      })
      .sync();
    return (
      row && {
        ...row,
        workingDirectories: row.workingDirectories.map((d) => d.path),
      }
    );
  }

  addComment(reviewSessionId: string, input: AddComment): Comment | undefined {
    const exists = this.db
      .select({ id: reviewSessions.id })
      .from(reviewSessions)
      .where(eq(reviewSessions.id, reviewSessionId))
      .get();
    if (!exists) return undefined;
    const comment: Comment = {
      id: randomUUID(),
      reviewSessionId,
      ...input,
      createdAt: new Date().toISOString(),
    };
    this.db.insert(comments).values(comment).run();
    return comment;
  }
}
```

</details>

##### Drizzle 1.0.0-rc.4

<details>
<summary><code>query/drizzle-rc/store.ts</code> (125 lines)</summary>

[Source](0006-review-server-libraries/query/drizzle-rc/store.ts)

```ts
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { defineRelations, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-sqlite';
import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';
import type {
  AddComment,
  Comment,
  CreateReviewSession,
  ReviewSession,
} from './types.ts';

const reviewSessions = sqliteTable('review_sessions', {
  id: text().primaryKey(),
  title: text(),
  startedAt: text('started_at').notNull(),
});

const workingDirectories = sqliteTable(
  'review_session_working_directories',
  {
    reviewSessionId: text('review_session_id')
      .notNull()
      .references(() => reviewSessions.id),
    path: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.reviewSessionId, t.path] })],
);

const comments = sqliteTable('comments', {
  id: text().primaryKey(),
  reviewSessionId: text('review_session_id')
    .notNull()
    .references(() => reviewSessions.id),
  path: text().notNull(),
  startLine: integer('start_line').notNull(),
  endLine: integer('end_line').notNull(),
  body: text().notNull(),
  createdAt: text('created_at').notNull(),
});

const schema = { reviewSessions, workingDirectories, comments };
const relations = defineRelations(schema, (r) => ({
  reviewSessions: {
    workingDirectories: r.many.workingDirectories({
      from: r.reviewSessions.id,
      to: r.workingDirectories.reviewSessionId,
    }),
    comments: r.many.comments({
      from: r.reviewSessions.id,
      to: r.comments.reviewSessionId,
    }),
  },
}));

const open = (client: DatabaseSync) => drizzle({ client, relations });

export class Store {
  private readonly db: ReturnType<typeof open>;

  private constructor(db: ReturnType<typeof open>) {
    this.db = db;
  }

  static open(file: string): Store {
    const client = new DatabaseSync(file);
    client.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
    return new Store(open(client));
  }

  createReviewSession(input: CreateReviewSession): ReviewSession {
    const id = randomUUID();
    this.db.transaction((tx) => {
      tx.insert(reviewSessions)
        .values({
          id,
          title: input.title ?? null,
          startedAt: new Date().toISOString(),
        })
        .run();
      tx.insert(workingDirectories)
        .values(
          input.workingDirectories.map((path) => ({
            reviewSessionId: id,
            path,
          })),
        )
        .run();
    });
    return this.getReviewSession(id)!;
  }

  getReviewSession(id: string): ReviewSession | undefined {
    const row = this.db.query.reviewSessions
      .findFirst({
        where: { id },
        with: {
          workingDirectories: {
            columns: { path: true },
            orderBy: { path: 'asc' },
          },
          comments: { orderBy: { createdAt: 'asc' } },
        },
      })
      .sync();
    return (
      row && {
        ...row,
        workingDirectories: row.workingDirectories.map((d) => d.path),
      }
    );
  }

  addComment(reviewSessionId: string, input: AddComment): Comment | undefined {
    const exists = this.db
      .select({ id: reviewSessions.id })
      .from(reviewSessions)
      .where(eq(reviewSessions.id, reviewSessionId))
      .get();
    if (!exists) return undefined;
    const comment: Comment = {
      id: randomUUID(),
      reviewSessionId,
      ...input,
      createdAt: new Date().toISOString(),
    };
    this.db.insert(comments).values(comment).run();
    return comment;
  }
}
```

</details>

##### Prisma 7.10.0

<details>
<summary><code>query/prisma/store.ts</code> (80 lines)</summary>

[Source](0006-review-server-libraries/query/prisma/store.ts)

```ts
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from './generated/client.ts';
import type {
  AddComment,
  Comment,
  CreateReviewSession,
  ReviewSession,
} from './types.ts';

export class Store {
  private readonly db: PrismaClient;

  private constructor(db: PrismaClient) {
    this.db = db;
  }

  static async open(file: string): Promise<Store> {
    const db = new PrismaClient({
      adapter: new PrismaBetterSqlite3({ url: file }),
    });
    const schema = readFileSync(
      new URL('./schema.sql', import.meta.url),
      'utf8',
    );
    for (const statement of schema.split(';').filter((s) => s.trim()))
      await db.$executeRawUnsafe(statement);
    return new Store(db);
  }

  async createReviewSession(
    input: CreateReviewSession,
  ): Promise<ReviewSession> {
    const id = randomUUID();
    await this.db.reviewSession.create({
      data: {
        id,
        title: input.title ?? null,
        startedAt: new Date().toISOString(),
        workingDirectories: {
          create: input.workingDirectories.map((path) => ({ path })),
        },
      },
    });
    return (await this.getReviewSession(id))!;
  }

  async getReviewSession(id: string): Promise<ReviewSession | undefined> {
    const row = await this.db.reviewSession.findUnique({
      where: { id },
      include: {
        workingDirectories: {
          select: { path: true },
          orderBy: { path: 'asc' },
        },
        comments: { orderBy: { createdAt: 'asc' } },
      },
    });
    return row
      ? {
          ...row,
          workingDirectories: row.workingDirectories.map((d) => d.path),
        }
      : undefined;
  }

  async addComment(
    reviewSessionId: string,
    input: AddComment,
  ): Promise<Comment | undefined> {
    const exists = await this.db.reviewSession.findUnique({
      where: { id: reviewSessionId },
      select: { id: true },
    });
    if (!exists) return undefined;
    return this.db.comment.create({
      data: {
        id: randomUUID(),
        reviewSessionId,
        ...input,
        createdAt: new Date().toISOString(),
      },
    });
  }
}
```

</details>

<details>
<summary><code>query/prisma/schema.prisma</code> (34 lines)</summary>

[Source](0006-review-server-libraries/query/prisma/schema.prisma)

```prisma
generator client {
  provider            = "prisma-client"
  output              = "./generated"
  importFileExtension = "ts"
}

datasource db {
  provider = "sqlite"
}

model ReviewSession {
  id                 String             @id
  title              String?
  startedAt          String             @map("started_at")
  workingDirectories WorkingDirectory[]
  comments           Comment[]

  @@map("review_sessions")
}

model WorkingDirectory {
  reviewSessionId String        @map("review_session_id")
  path            String
  reviewSession   ReviewSession @relation(fields: [reviewSessionId], references: [id])

  @@id([reviewSessionId, path])
  @@map("review_session_working_directories")
}

model Comment {
  id              String        @id
  reviewSessionId String        @map("review_session_id")
  path            String
  startLine       Int           @map("start_line")
  endLine         Int           @map("end_line")
  body            String
  createdAt       String        @map("created_at")
  reviewSession   ReviewSession @relation(fields: [reviewSessionId], references: [id])

  @@map("comments")
}
```

</details>

### Maintenance

From the npm registry and GitHub on 2026-10-14. "Versions in a year" counts
every version published from 2025-10-14, including prereleases and canary
builds.

| Package           | Latest  | Released   | Versions in a year |  Stars | Last push  | Notes                                                 |
| ----------------- | ------- | ---------- | -----------------: | -----: | ---------- | ----------------------------------------------------- |
| hono              | 4.13.13 | 2026-10-04 |                 71 | 32,525 | 2026-10-13 |                                                       |
| fastify           | 5.12.7  | 2026-10-13 |                 32 | 37,269 | 2026-10-13 |                                                       |
| express           | 5.3.0   | 2026-10-09 |                  7 | 69,652 | 2026-10-09 |                                                       |
| h3                | 2.0.2   | 2026-10-07 |                 40 |  5,463 | 2026-10-07 | 2.x is the current line; 1.x is maintained as `1x`    |
| elysia            | 1.4.30  | 2026-08-26 |                122 | 19,245 | 2026-10-11 | `next` is 2.0.0-beta.31; `@elysia/node` has 2.0 betas |
| @trpc/server      | 11.19.0 | 2026-09-16 |                 81 | 40,704 | 2026-10-11 |                                                       |
| @orpc/server      | 1.15.6  | 2026-10-12 |                261 |  5,684 | 2026-10-14 |                                                       |
| @ts-rest/core     | 3.52.1  | 2025-03-04 |                  0 |  3,341 | 2026-02-06 |                                                       |
| koa               | 3.2.1   | 2026-05-21 |                  9 | 35,677 | 2026-10-09 |                                                       |
| zod               | 4.6.7   | 2026-10-12 |                231 | 44,118 | 2026-10-13 |                                                       |
| valibot           | 1.5.0   | 2026-09-09 |                  7 |  9,037 | 2026-10-10 |                                                       |
| arktype           | 2.2.8   | 2026-10-07 |                 15 |  7,874 | 2026-10-13 |                                                       |
| typebox           | 1.3.37  | 2026-10-12 |                144 |  6,994 | 2026-10-14 | Successor to `@sinclair/typebox` 0.34                 |
| effect            | 4.0.4   | 2026-10-13 |                153 | 17,272 | 2026-10-14 |                                                       |
| better-sqlite3    | 13.0.3  | 2026-08-05 |                 14 |  7,517 | 2026-08-10 |                                                       |
| libsql            | 0.5.29  | 2026-03-25 |                 21 |    335 | 2026-09-29 |                                                       |
| @libsql/client    | 0.18.0  | 2026-09-02 |                  8 |    577 | 2026-09-02 |                                                       |
| sqlite3           | 6.0.1   | 2026-03-12 |                  1 |  6,409 | 2026-06-27 | Repository archived                                   |
| node-sqlite3-wasm | 0.8.60  | 2026-07-28 |                 10 |     94 | 2026-10-13 |                                                       |
| kysely            | 0.29.6  | 2026-09-16 |                 20 | 14,269 | 2026-10-13 |                                                       |
| drizzle-orm       | 0.45.4  | 2026-10-08 |                285 | 36,029 | 2026-10-13 | 1.0.0-rc.4 under the `rc` tag                         |
| @prisma/client    | 7.10.0  | 2026-08-25 |                520 | 47,692 | 2026-10-14 | `prisma`'s `latest` tag is 8.0.0-rc.22                |

### Candidates not built

- **Koa** 3.2.1: routes and bodies aren't typed from definitions, and routing is
  a separate package.
- **ts-rest**: no version published in the last year.
- **Effect's `HttpApi`**, in `effect` 4.0.4: defines an API with Effect Schema
  and derives a typed client and OpenAPI from it. Its install is the 56 MB
  `effect` package, which took 1.3 seconds to load in the validation example.
- **Typia**: generates validators from TypeScript types with a compiler
  transform, which is a build step.
- **Yup, Joi, and Superstruct** weren't checked.

## Options

The layers can be chosen separately, except that a typed client comes from the
HTTP layer. These are the combinations the findings suggest.

### `node:http` or h3, with hand-written clients

Keep the prototype's shape: a small router, a validation library called in each
handler, and `fetch` clients that share the schemas.

Benefits:

- The fewest dependencies. h3 adds 1.3 MB and 3 packages over Zod, with
  `readValidatedBody` for any Standard Schema and an `EventStream` class.
- Nothing between the handler and the response, so status codes and errors are
  exactly what's written.
- The CLI loads only `fetch` and, if it parses responses, the schemas.

Costs:

- Neither the server nor the clients catch a handler returning the wrong shape.
  Routes are strings, so a client can call a path that doesn't exist.
- Each client wraps every route by hand, as the 75-line `fetch` client does.
- The baseline repeats routing, body parsing, and error handling that every
  framework provides. h3's route parameters aren't typed.

### Hono with its `hc` client

Benefits:

- The shortest server and client in the examples (60 and 56 lines), 3.2 MB and 4
  packages over Zod, and a client that loads in 250 ms.
- The client's request bodies, parameters, and responses are typed from the
  server's routes, through `import type`, so the CLI loads no server code.
- Validation through any Standard Schema library, and `streamSSE` for events.
- Web-standard `Request` and `Response`, so the same app runs on Node, Bun, and
  Deno.

Costs:

- Response types are inferred from handlers, so a wrong shape reaches the
  client's types rather than failing on the server. Declared response schemas
  need `@hono/zod-openapi`.
- The client's types come from chaining the route calls, and Hono's docs say the
  editor slows down as routes are added and suggest compiling the client type
  ahead of time with `hcWithType`
  ([Hono RPC](https://hono.dev/docs/guides/rpc)). Not measured here.
- The default validation error is the issues as JSON; readable messages need a
  hook on each validator.

### oRPC with a contract

Benefits:

- The contract declares each route's method, path, input, output, status, and
  errors once. The server implements it, so `tsc` rejects a handler that returns
  the wrong shape, and clients are typed from it.
- REST paths and an OpenAPI document from the same contract, and typed event
  iterators over SSE with an `EventPublisher`.
- Typed errors, such as `errors.NOT_FOUND()`, that clients can tell apart.

Costs:

- The client needs the contract at run time, so the CLI loads the schemas on
  every call: 572 ms with Zod in the example, 352 ms with Valibot, against 250
  ms for Hono's client.
- Three files instead of two, and more concepts: contracts, implementers, links,
  interceptors, and input structures.
- 261 versions published in a year, and 5,684 stars, fewer than the other
  frameworks.
- The client doesn't expose the HTTP status of a successful call.

### tRPC

Benefits:

- Widely used (40,704 stars), with a typed client from `import type` and
  subscriptions as async generators.
- Procedures read like function calls, with no paths or methods to design.

Costs:

- Installs TypeScript as a required peer, even in production installs: 42.7 MB
  for the example.
- Not REST: routes are procedure names, successes are always 200, and errors use
  tRPC's envelope, so the API is harder to call with `curl` or from a harness
  that doesn't use the tRPC client.
- Node clients need an `EventSource` package for subscriptions.
- Stack traces in error responses unless `NODE_ENV` is `production`, and the
  lowest throughput in the examples (439 requests/s, not investigated).
- No declared response types unless each procedure adds `.output()`.

### Fastify with a type provider

Benefits:

- Declared request and response schemas per route: `tsc` caught the wrong
  response type, and responses are serialized from the schema.
- Mature plugins, such as `@fastify/swagger` for OpenAPI, and the highest
  throughput of the frameworks (1,746 requests/s).

Costs:

- No typed client. The review UI and the CLI would use hand-written clients or a
  client generated from OpenAPI.
- 58 packages, 16 MB over Zod, and the slowest startup apart from Elysia (1,014
  ms against 651 ms).
- Handlers have to call `reply.send()` without returning it to satisfy the
  types, and SSE needs `reply.hijack()` and the raw response.

### Express 5

Benefits:

- The most widely known framework (69,652 stars), stable, and small to write
  for: 53 lines, the shortest server.

Costs:

- No typed routes, bodies, or client. `req.body` is `any` until validated.
- 77 packages, and an HTML error page with a stack trace for invalid JSON unless
  `NODE_ENV` is `production`.

### Elysia with Eden

Benefits:

- Declared request and response schemas, checked by `tsc`, and a typed client
  from `import type` that loads in 242 ms. Events are typed from a generator.

Costs:

- Bun-first. On Node it needs an adapter, which the docs now name
  `@elysia/node`; the older `@elysiajs/node` is still published. It had the
  slowest startup (1,239 ms).
- Validation errors are a JSON document in a string, and leaving an Eden stream
  doesn't close it.
- A 2.0 line is in beta (`next` is 2.0.0-beta.31).

### Validation

- **Zod** is accepted by every framework above, its errors were the most
  readable with `z.prettifyError`, and it generates JSON Schema. It's the
  largest of the light options in the browser (27.3 KB gzipped), and loading it
  added about 300 ms to a process.
- **Zod Mini** has the same behaviour at 9.0 KB gzipped, with a functional API
  (`.check(z.minLength(1))`) and English messages loaded by hand.
- **Valibot** is the smallest (2.8 KB gzipped, 241 ms to load), reported the
  check across fields alongside field errors, and was fastest on invalid input.
  Its pipes are more verbose, and its JSON Schema converter is a separate
  package that throws on custom checks by default.
- **ArkType** is the most concise (29 lines) and has readable messages, but
  stops at the first failing level, is 47.5 KB gzipped, and took 1.3 seconds to
  load.
- **TypeBox**'s schemas are JSON Schema and its compiled validator was the
  fastest by far, but it doesn't implement Standard Schema, its union errors are
  noisy, and it took 1.2 seconds to load.
- **Effect Schema** fits a codebase that uses Effect. Alone, it's the largest
  install and bundle.

### SQLite driver and query layer

- **`node:sqlite` with SQL:** nothing to install, the fastest in the bulk and
  single-insert phases, and the shortest load time with a store. Rows are cast
  by hand. It's a release candidate, and Node 26 renamed its main class.
- **better-sqlite3:** the most established synchronous driver, typed statement
  parameters, and the fastest reads here, for 30 MB of prebuilt binaries for
  platforms the server may never run on.
- **Kysely over either driver:** typed queries from a hand-written database
  interface, 3.4 MB and one package. Needs a small adapter for `node:sqlite`,
  makes every call async, and added 579 ms to load and about 36% to reads.
- **Drizzle:** types from table definitions, relational queries, and
  `drizzle-kit` migrations. `node:sqlite` support is only in the 1.0 release
  candidate, it took about 2 seconds to load here, and reads were about four
  times slower than SQL.
- **Prisma:** the shortest store and generated types, for a `prisma generate`
  step, 87 MB for the client and adapter, and reads about four times slower than
  SQL.
- **libsql, `@libsql/client`, sqlite3, and node-sqlite3-wasm** were slower on
  every phase here. sqlite3 is archived, and node-sqlite3-wasm can't use WAL.

## Gaps

Checked by hand:

- Every example was installed in a scratch directory outside the repo,
  type-checked with TypeScript 7.0.2, and run on Node 24.21.0 with type
  stripping and no build step. Prisma's client was generated first. The outputs
  and numbers in this doc come from those runs.
- The server examples' clients ran against their servers, and their output was
  compared with the baseline's. The raw responses were captured with `curl`.
- The wrong-response-type probe, the `any` probe on typed clients, the type
  equality checks for validation, and a check that the type equality test fails
  when a type differs.
- The tRPC production install, Prisma's install without its CLI, and
  node-sqlite3-wasm's journal mode.

Not checked:

- WebSockets. Only SSE was built, as in the prototype.
- oRPC's `RPCHandler` and `RPCLink`, which use oRPC's own protocol instead of
  REST paths, and don't need the contract at run time.
- Request validation in the browser, typed clients' bundle sizes in the review
  UI, and whether the review UI and CLI can share one client.
- Hono's `@hono/zod-openapi`, tRPC's `.output()`, Fastify's and Elysia's OpenAPI
  packages, and Fastify's TypeBox type provider.
- Effect's `HttpApi`, Koa, ts-rest, Elysia on Bun, and Bun in general.
- Migrations: `drizzle-kit`, `prisma migrate`, and Kysely's `Migrator` weren't
  run.
- Several processes sharing one database, and WAL checkpointing under load.
- Native driver installs on macOS, Windows, Alpine, or ARM. Only linux-x64 with
  glibc was installed.
- Validators' fallbacks when `new Function` isn't allowed.
- Why tRPC's throughput was lower, and throughput with more realistic routes.
- Node 24.20.0, which `.node-version` pins, and Node 26 beyond two spot checks.
- Startup on other machines. The Atom C3858 is slow, so absolute times will be
  lower elsewhere; differences between candidates are the useful part.
- Maintenance beyond release dates, version counts, stars, and last push.
