# 0025: The API is declared contract-first, and called over oRPC's RPC protocol

- Status: Accepted
- Date: 2026-10-15

## Problem

[0021](0021-orpc-and-valibot-build-the-api.md) builds the
[review server](../glossary.md#review-server)'s API with oRPC and Valibot, but
leaves two follow-up choices open:

- **Protocol.** REST paths with `OpenAPIHandler` and `OpenAPILink`, which need
  the route definitions at run time, or oRPC's own protocol with `RPCHandler`
  and `RPCLink`, where clients need only types.
- **Contract or router first.** Whether routes are declared in a contract with
  `@orpc/contract`, which the server implements and clients import, or derived
  from the server's router.

The [review UI](../glossary.md#review-ui) and the `agent-diff` CLI both call the
API ([0011](0011-api-core-with-cli-client.md)), and the CLI starts a process for
every call. [Research 0006](../research/0006-review-server-libraries.md)'s oRPC
and Valibot example used a contract with `OpenAPIHandler` and `OpenAPILink`.

## Solution

- **Contract first.** The API is declared with `@orpc/contract` in
  `packages/shared`, with Valibot schemas for each procedure's input and output.
  No API types are written by hand outside the contract.
- **The review server implements it** with `implement(contract)` from
  `@orpc/server`, and serves it with `RPCHandler` under `/api`.
- **Clients call it through `RPCLink`** from `@orpc/client`, typed as
  `ContractRouterClient<typeof contract>`. The CLI and the review UI use the
  same contract.

From `packages/shared/src/contract.ts`, where `HelloInput` and `HelloOutput` are
Valibot schemas:

```ts
export const contract = {
  health: oc.output(Health),
  hello: oc.input(HelloInput).output(HelloOutput),
};
```

### Effect on earlier decisions

- **[0021](0021-orpc-and-valibot-build-the-api.md).** Its "Protocol" and
  "Contract or router first" follow-ups are answered. Procedures don't declare
  REST paths, so 0021's benefit that REST paths and an OpenAPI document come
  from the same definitions doesn't apply while the RPC protocol is used.

## Tradeoffs

Benefits:

- The contract is a small module with no server code, so the review UI and the
  CLI import it without pulling in the review server, its database, or Node
  APIs.
- With `RPCLink`, clients don't need route definitions to build requests. The
  CLI imports the contract only for its types.
- `tsc` rejects a handler whose output doesn't match the contract, and a client
  call whose input doesn't.
- oRPC's RPC protocol carries types JSON can't, such as `Date`, `Map`, and
  `BigInt`, so values arrive as the types the contract declares.
- Adding a procedure doesn't need choosing a method, a path, or how input maps
  to them.

Costs:

- The wire format is oRPC's own, so other tools such as `curl` or a harness
  written in another language can't call the API as easily as a REST API.
- There's no OpenAPI document to publish while the RPC protocol is used, which
  bears on 0011's open question of whether harnesses can rely on the API.
- Each procedure is declared twice, once in the contract and once as a handler
  in the review server, rather than once in a router.

## Follow-up design choices

- **OpenAPI.** Whether to also serve the contract with `OpenAPIHandler`, which
  would need REST paths on each procedure, if harnesses need a documented API.
- **Error format.** How validation errors are worded for agents reading the
  CLI's output, still open from 0021. For now, the review server replaces oRPC's
  "Input validation failed" with the schemas' own messages.
