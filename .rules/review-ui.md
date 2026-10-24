# Laying out the review UI

The review UI, in `packages/ui`, is routed by TanStack Router, and loads its
data through TanStack Query. Follow this layout whenever you change it.

## Pages and routes

- Each page is a component in `packages/ui/src/pages/<Name>Page.tsx`, exporting
  `<Name>Page`, such as `SessionPage` in `SessionPage.tsx`.
- Routes are code-based, in `packages/ui/src/router.tsx`, and each route's
  component is a page.

## Loading data

- Pages get their data from route loaders that call
  `queryClient.ensureQueryData` with the oRPC query options, such as
  `orpc.session.show.queryOptions({ input: { id } })`. The `queryClient` is in
  the router's context.
- Pages read the data with `useSuspenseQuery` and the same options, so they
  don't handle loading or errors themselves.

## Other components

- Components shared by pages, and the pending and error components routes use,
  go in `packages/ui/src/components`.
