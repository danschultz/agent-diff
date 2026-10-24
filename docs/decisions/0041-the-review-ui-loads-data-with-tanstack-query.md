# 0041: The review UI loads data from the review server with TanStack Query

- Status: Accepted
- Date: 2026-10-23

## Problem

[0016](0016-tanstack-store-with-immer.md) holds the
[review UI](../glossary.md#review-ui)'s state in TanStack Store, but leaves open
whether data loaded from the [review server](../glossary.md#review-server), such
as sessions, file lists, diffs, comments, and reviews, is held in stores or in a
data-fetching library such as TanStack Query.

The review UI's first page, a [session](../glossary.md#session) at
`/sessions/<id>`
([0040](0040-sessions-have-short-ids-and-cover-working-directories-by-real-path.md)),
loaded its session in a `useEffect`, with its own loading and error states and
an `AbortController`. Every page that loads data would repeat that.

## Solution

- **TanStack Query loads data from the review server.** The review UI uses
  `@tanstack/react-query`, with oRPC's integration, `@orpc/tanstack-query`,
  which builds query options and keys from the contract
  ([0025](0025-contract-first-orpc-over-rpc.md)):

  ```tsx
  const { data: session, error } = useQuery(
    orpc.session.show.queryOptions({ input: { id } }),
  );
  ```

- **One query client.** `packages/ui/src/client.ts` creates the oRPC client,
  `orpc`, the query and mutation options built from it, and the `QueryClient`,
  which `main.tsx` provides to the whole review UI.
- **No refetching until live updates are designed.** A page shows what the API
  returned when it loaded, so queries never go stale, and aren't fetched again
  when the window regains focus or the network reconnects.
- **Only calls that didn't reach the review server are retried.** An error the
  review server answers with, such as a 401 or an unknown session, is shown at
  once. A call that failed before reaching it, such as a refused connection, is
  retried up to 3 times.
- **TanStack Store keeps the reviewer's own state,** such as the
  [diff mode](../glossary.md#diff-mode), selection, and the draft review, as
  0016 says.
- **Versions are pinned:** `@tanstack/react-query` 5.104.5 and
  `@orpc/tanstack-query` 1.15.7, the same version as the other oRPC packages.

### Effect on earlier decisions

- **[0016](0016-tanstack-store-with-immer.md).** Answers the follow-up on data
  loaded from the review server: it's held in TanStack Query's cache, and stores
  hold the reviewer's UI state and the draft review.

## Tradeoffs

Benefits:

- Loading, error, and cached states come from one place, so each page doesn't
  write its own effect, abort handling, and state.
- Query options and keys come from the contract, so they're typed like the
  client and can't drift from the API.
- Two components that need the same data share one call and one cache entry.
- Pushed updates and mutations, when they're designed, have a cache to update or
  invalidate.

Costs:

- Two runtime dependencies in the review UI, and a second TanStack library with
  its own concepts beside TanStack Store.
- The defaults have to be changed to keep pages from refetching, and changed
  again once live updates are designed.
- Data now lives in two places, the query cache and stores, so each new piece of
  state needs a choice of where it goes.

## Follow-up design choices

- **Live updates.** Whether events pushed by the review server
  ([0007](0007-live-reload-from-file-watching.md),
  [0021](0021-orpc-and-valibot-build-the-api.md)) write into the query cache or
  invalidate queries, and which defaults change then.
- **Mutations.** Whether saving comments and replies, and submitting reviews,
  use TanStack Query's mutations, with optimistic updates.
- **Devtools.** Whether the review UI loads TanStack Query's devtools in
  development.
