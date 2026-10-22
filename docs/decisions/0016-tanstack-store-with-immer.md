# 0016: The review UI's state is held in TanStack Store, updated through Immer

- Status: Accepted
- Date: 2026-10-14

## Problem

The prototype keeps the [review UI](../glossary.md#review-ui)'s state in React
components, with 26 `useState` calls in `prototype/src/ui/App.tsx` alone, and an
`EventSource` handler kept in a `useRef` so it can see current state. Dan wants
a state management library that is lightweight, type safe, takes little code to
define, read, and change state, and is easy for agents to work in
([#14](https://github.com/danschultz/agent-diff/issues/14)). State is often
replaced by updates pushed from the
[review server](../glossary.md#review-server) as files change
([0007](0007-live-reload-from-file-watching.md)). This also answers part of the
"Which frontend and backend stack to use" follow-up in
[0001](0001-local-web-app.md).

[0002](../research/0002-react-state-management.md) compared plain React and ten
libraries on those criteria with the same drafts example.
[0003](../research/0003-immer-and-inferred-store-types.md) followed up on
Zustand and TanStack Store with Immer, on which libraries infer a store's type
from methods with typed parameters, and on a `createImmerStore` helper for
TanStack Store.

## Solution

The review UI's state is held in TanStack Store (`@tanstack/react-store`), and
changed through Immer. Every store is created with a `createImmerStore` helper,
which
[0003](../research/0003-immer-and-inferred-store-types.md#a-createimmerstore-helper-for-tanstack-store)
checked:

```ts
import { createStore, type StoreActionMap } from '@tanstack/react-store';
import { produce, type Draft as Writable, type Immutable } from 'immer';

export function createImmerStore<
  T extends object,
  TActions extends StoreActionMap,
>(
  initial: T,
  actions: (store: {
    update: (recipe: (state: Writable<T>) => unknown) => void;
    get: () => Immutable<T>;
  }) => TActions,
) {
  // createStore rejects function state with a conditional type that
  // TypeScript can't check for a generic T. `T extends object` doesn't rule
  // out functions, but state never is one.
  return createStore<Immutable<T>, TActions>(
    initial as never,
    ({ setState, get }) =>
      actions({
        // The recipe's return value is ignored, so one-line assignments
        // don't replace the state.
        update: (recipe) =>
          setState((prev) =>
            produce(prev, (state) => {
              recipe(state as Writable<T>);
            }),
          ),
        get,
      }),
  );
}
```

A store written with it, from 0003:

```tsx
import { useSelector } from '@tanstack/react-store';
import { createImmerStore } from './createImmerStore.ts';
import type { Draft } from './types.ts';

export const draftsStore = createImmerStore(
  { drafts: {} as Record<string, Draft> },
  ({ update, get }) => ({
    addDraft(draft: Draft) {
      update((s) => (s.drafts[draft.id] = draft));
    },
    editDraft(id: string, body: string) {
      update((s) => {
        const draft = s.drafts[id];
        if (draft) draft.body = body;
      });
    },
    discardDraft(id: string) {
      update((s) => delete s.drafts[id]);
    },
    replaceDrafts(drafts: Draft[]) {
      update(
        (s) => (s.drafts = Object.fromEntries(drafts.map((d) => [d.id, d]))),
      );
    },
    count(path: string) {
      return Object.values(get().drafts).filter((d) => d.path === path).length;
    },
  }),
);

export function DraftCount({ path }: { path: string }) {
  const count = useSelector(draftsStore, () => draftsStore.actions.count(path));
  return <>{count}</>;
}
```

Conventions:

- **Stores are created with `createImmerStore`**, not `createStore`, so every
  store changes state the same way and has read-only state types.
- **Types are inferred.** A store's state type comes from its initial state, and
  its actions' types from methods with typed parameters, written with method
  syntax. Store types aren't declared separately.
- **Actions change state with `update`**, by assigning to or deleting from the
  state they're given. They don't copy objects by hand or return new state.
- **Values computed from state are store methods**, such as `count(path)`, that
  read it with `get()`.
- **Components read with `useSelector`**, selecting the smallest value they
  need, and call store methods inside the selector so they stay subscribed.
- **Updates pushed from the review server call store actions** directly from the
  `EventSource` handler, with no `useRef`.
- **Read-only types are kept.** Functions that take arrays from a store type
  their parameters as `readonly`.
- CodeMirror's `EditorState` isn't held in a store
  ([0012](0012-codemirror-renders-diffs.md)). Stores hold the values CodeMirror
  is configured from.

## Tradeoffs

Benefits:

- Types are inferred from the initial state and typed methods, so each action's
  signature is written once.
- The only option checked where both `tsc` and the run time catch mutating state
  read from a store: `tsc` through Immer's `Immutable` types, and the run time
  because Immer freezes state.
- Short stores: the drafts example is 32 lines, with one-line updates and no
  spreading.
- Components that select a value re-render only when it changes. `DraftCount`
  didn't re-render on a body edit or on an equal pushed update.
- Stores can be read and changed outside React, so the `EventSource` handler
  calls actions directly.
- TanStack Store's docs publish an `llms.txt`, and Immer is widely used,
  including inside Redux Toolkit.
- If TanStack Store's API changes before 1.0, most of the change is in one
  helper.

Costs:

- TanStack Store is before 1.0. It had API changes in four minor versions in the
  year before 0002, a 1.0 alpha is published, and `createStore` with an actions
  factory only arrived in 0.11, so agents' training data likely shows older
  APIs.
- `createImmerStore` is a 31-line local helper with a cast. TanStack doesn't
  document it, so agents learn it from the repo.
- 6.7 KB minified and gzipped, about 3.8 KB of it Immer, compared with 391 bytes
  for Zustand alone. This is small next to the review UI's 734 KB of JavaScript
  with CodeMirror ([0012](0012-codemirror-renders-diffs.md)).
- Read-only state types mean functions taking arrays from a store need
  `readonly` parameter types.
- Immer freezes objects passed into actions, so code that keeps a reference to
  an object after passing it to an action can't change it.
- How many apps use TanStack Store directly isn't known: 0002 found its download
  count mostly comes from other TanStack libraries that depend on it.

## Follow-up design choices

- **Where the helper lives.** Which package or directory holds
  `createImmerStore`, and its tests.
- **Versions.** Whether to pin TanStack Store's exact version, and when to move
  to 1.0.
- **How state is split into stores.** Which of the review UI's state, such as
  the [session](../glossary.md#session), [diff mode](../glossary.md#diff-mode),
  [file view](../glossary.md#file-view), selection, and drafts, shares a store.
- **Data loaded from the review server.** Whether file lists, diffs, comments,
  and reviews are held in stores or in a data-fetching library such as TanStack
  Query, with stores holding the reviewer's UI state and drafts.
- **Selecting objects after pushed updates.** Replacing state creates new
  objects, so components that select an object rather than a value re-render on
  each pushed update unless they compare by value. 0003 only measured a
  component that selects a number.
- **Production builds.** Whether Immer's freezing stays on in production, and
  Immer's cost on large updates.
- **React Compiler** compatibility, which wasn't checked.
- **Agent guidance.** Where the conventions above are written down so agents
  find them, such as a rule in `.rules/`.
