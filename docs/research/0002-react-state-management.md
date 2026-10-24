# 0002: Which React state management library fits the review UI?

- Date: 2026-10-13

## Question

The [review UI](../glossary.md#review-ui) is a local React 19 web app
([0001](../decisions/0001-local-web-app.md)). The prototype keeps its state in
React components: `prototype/src/ui/App.tsx` alone has 26 `useState` calls. Dan
wants to choose a state management library for the review UI
([#14](https://github.com/danschultz/agent-diff/issues/14)) that:

- Is lightweight.
- Is type safe.
- Takes little code to define, read, and change state.
- Is easy for agents to work in.

This research compares the candidates on those four criteria, and on how each
one handles state that's replaced by updates pushed from the
[review server](../glossary.md#review-server). It doesn't choose one.
Server-state and data-fetching libraries, such as TanStack Query, are only
covered where a candidate works alongside them.

## Findings

### The state involved

The review UI holds:

- The [session](../glossary.md#session) and its
  [working directories](../glossary.md#working-directory).
- The selected [diff mode](../glossary.md#diff-mode).
- The [file view](../glossary.md#file-view): tree or list, and whether unchanged
  files are shown.
- The selected file and line.
- The [draft review](../glossary.md#draft-review), and each
  [comment](../glossary.md#comment)'s
  [anchor state](../glossary.md#anchor-state).
- File lists, diffs, comments, reviews, and
  [turn snapshots](../glossary.md#turn-snapshot) loaded from the review server.

In the prototype, the review server sends events over an `EventSource`
(`prototype/src/ui/App.tsx`, from the "Server events" comment). The handler
doesn't apply the event's contents. It refetches the affected data and replaces
it in `useState`, for example `loadComments()` after a `comments-changed` event.
The handler is kept in a `useRef` and reassigned on every render, so the
long-lived `EventSource` sees the current `useState` values. The diff updates
live as files change
([0007](../decisions/0007-live-reload-from-file-watching.md)), so this
replacement happens often.

Diffs are rendered by CodeMirror
([0012](../decisions/0012-codemirror-renders-diffs.md)), which keeps the
editor's document, selection, and scroll position in its own `EditorState`.
Whatever library is chosen holds the review UI's state next to it, not the
editor's.

### How the candidates were checked

All checks were run on 2026-10-13 in a scratch directory outside the repo
(`$CLAUDE_JOB_DIR/tmp/sm`), on Node 26.11.1, with React and React DOM 19.3.0,
`@types/react` 19, and TypeScript 7.0.2. The repo's dependencies weren't
changed.

- **Versions** are the npm `latest` tag on 2026-10-13, except Legend-State,
  whose docs install the `beta` tag (see [Maintenance](#maintenance)).
- **Size** is measured with esbuild 0.28.2: a file that re-exports the functions
  an example imports is bundled with `--minify`, `NODE_ENV=production`, and
  `react`, `react-dom`, and `react/jsx-runtime` marked external, then compressed
  with `gzip -9`. "Whole package" bundles `export *` from the core and React
  entry points. Dependencies, such as Immer for Redux Toolkit, are included.
- **The examples** below were type-checked with `tsc` using the prototype's
  compiler options (`strict`, `module: preserve`, `moduleResolution: bundler`,
  `jsx: react-jsx`), and formatted with Prettier 3.9.10 at a print width of 100
  so their line counts compare.
- **Type-checker probes.** For each example, a file made five mistakes and `tsc`
  was run to see which it reported (see [Type safety](#type-safety)).
- **Running the examples.** Each example was bundled with esbuild and run in
  Node with [happy-dom](https://github.com/capricorn86/happy-dom) as the DOM. A
  test mounted `<DraftCount path="a.ts" />` with `react-dom/client` and `act`,
  then added three comments, edited one, discarded one, replaced them all as a
  pushed update would, edited a comment that doesn't exist, and pushed an update
  equal to the current state. After each step it checked the rendered count and
  the stored comments. A `Profiler` counted how often `DraftCount` re-rendered.
  All twelve examples passed all nine checks.
- **Maintenance** data comes from `npm view <package> time`, the npm downloads
  API, and the GitHub repo API.

Preact Signals (`@preact/signals-react`) was added to the brief's list, since
signals are a distinct approach that the other candidates don't cover.

### Size

Minified and gzipped, in bytes, for the version checked.

| Candidate       | Version                                            | Used by the example | Whole package |
| --------------- | -------------------------------------------------- | ------------------: | ------------: |
| Plain React     | `react` 19.3.0                                     |   0 (part of React) |             0 |
| Zustand         | `zustand` 5.0.15                                   |                 406 |           422 |
| Nanostores      | `nanostores` 1.5.5, `@nanostores/react` 2.0.1      |               1,072 |         2,745 |
| Valtio          | `valtio` 2.3.2                                     |               2,496 |         2,779 |
| TanStack Store  | `@tanstack/react-store` 0.11.2                     |               3,014 |         3,703 |
| `@xstate/store` | `@xstate/store` 4.3.0, `@xstate/store-react` 2.1.0 |               3,151 |         4,663 |
| Jotai           | `jotai` 3.0.1                                      |               3,163 |         3,445 |
| Preact Signals  | `@preact/signals-react` 3.12.0                     |               3,266 |         3,790 |
| Redux Toolkit   | `@reduxjs/toolkit` 2.13.0, `react-redux` 9.3.0     |              10,498 |        19,394 |
| Legend-State    | `@legendapp/state` 3.0.0-beta.48                   |              12,102 |        14,464 |
| MobX            | `mobx` 7.0.6, `mobx-react-lite` 5.1.0              |              13,609 |        17,183 |

For scale, the review UI with CodeMirror loads about 734 KB of uncompressed
JavaScript ([0012](../decisions/0012-codemirror-renders-diffs.md)).

- Zustand 5 uses React's built-in `useSyncExternalStore`, so its React entry is
  a few hundred bytes ([npm](https://www.npmjs.com/package/zustand)).
- MobX 7's release notes give 13.96 KiB for the production ESM build, down from
  17.02 KiB in MobX 6
  ([CHANGELOG](https://github.com/mobxjs/mobx/blob/main/packages/mobx/CHANGELOG.md#700)).
  That's close to the 13.6 KB measured here with `mobx-react-lite`.
- Redux Toolkit's size includes Immer, Reselect, Redux, and Redux Thunk, which
  `configureStore` and `createSlice` pull in
  ([`package.json` dependencies](https://www.npmjs.com/package/@reduxjs/toolkit?activeTab=dependencies)).

### Maintenance

"Stable releases" counts non-prerelease versions published from 2025-10-13 to
2026-10-13. "React peer range" is the package's `peerDependencies`. Every
candidate accepts React 19, and all twelve examples ran on React 19.3.0.

| Candidate       | Latest stable      | Stable releases in the last year | Current major since                               | React peer range                                     |
| --------------- | ------------------ | -------------------------------: | ------------------------------------------------- | ---------------------------------------------------- |
| Zustand         | 5.0.15, 2026-08-13 |                                7 | 5.0.0, 2024-10-14                                 | `>=18.0.0`                                           |
| Jotai           | 3.0.1, 2026-09-29  |                               17 | 3.0.0, 2026-09-08                                 | `>=18.0.0`                                           |
| Valtio          | 2.3.2, 2026-05-01  |                                4 | 2.0.0, 2024-08-29                                 | `>=18.0.0`                                           |
| MobX            | 7.0.6, 2026-10-02  |                               13 | 7.0.0, 2026-07-30                                 | `^18 \|\| ^19` (`mobx-react-lite` 5.1.0)             |
| Redux Toolkit   | 2.13.0, 2026-09-29 |                                9 | 2.0.0, 2023-12-04                                 | `^16.9.0 \|\| ^17.0.0 \|\| ^18 \|\| ^19`             |
| `@xstate/store` | 4.3.0, 2026-10-08  |                               22 | 4.0.0, 2026-05-27                                 | `^18.0.0 \|\| ^19.0.0` (`@xstate/store-react` 2.1.0) |
| Legend-State    | 2.1.15, 2024-08-30 |                  0 (13 v3 betas) | 3.0.0 still in beta; beta.48 on 2026-07-12        | `>=16.8.0` (v2); none declared (v3 beta)             |
| Nanostores      | 1.5.5, 2026-10-06  |                               13 | 1.0.0, 2025-04-10                                 | `>=18.0.0` (`@nanostores/react` 2.0.1)               |
| TanStack Store  | 0.11.2, 2026-09-29 |                                9 | Pre-1.0; 0.11.0 on 2026-04-17, a 1.0 alpha exists | `^16.8.0` to `^19.0.0`                               |
| Preact Signals  | 3.12.0, 2026-08-04 |                               16 | 3.0.0, 2025-01-02                                 | `^16.14.0 \|\| 17.x \|\| 18.x \|\| 19.x`             |
| Plain React     | 19.3.0             |                                — | —                                                 | —                                                    |

Sources: `npm view <package> time dist-tags peerDependencies` on 2026-10-13, and
the npm pages for [zustand](https://www.npmjs.com/package/zustand),
[jotai](https://www.npmjs.com/package/jotai),
[valtio](https://www.npmjs.com/package/valtio),
[mobx](https://www.npmjs.com/package/mobx),
[@reduxjs/toolkit](https://www.npmjs.com/package/@reduxjs/toolkit),
[@xstate/store](https://www.npmjs.com/package/@xstate/store),
[@legendapp/state](https://www.npmjs.com/package/@legendapp/state),
[nanostores](https://www.npmjs.com/package/nanostores),
[@tanstack/store](https://www.npmjs.com/package/@tanstack/store), and
[@preact/signals-react](https://www.npmjs.com/package/@preact/signals-react).
Every candidate's GitHub repo had a push within the last six weeks, and none is
archived (GitHub API, 2026-10-13).

Recent breaking changes:

- **Jotai 3** (2026-09-08) keeps the public API. It requires React 18,
  TypeScript 5.5, and Node 22.12, ships ESM only, and only exposes the public
  entry points
  ([migration guide](https://github.com/pmndrs/jotai/blob/main/docs/guides/migrating-to-v3.mdx)).
- **MobX 7** (2026-07-30) always uses proxies, drops legacy decorators, renames
  namespaced APIs such as `observable.ref` to `observableRef`, and removes
  `Provider`, `inject`, and `useLocalStore` from the React bindings
  ([CHANGELOG](https://github.com/mobxjs/mobx/blob/main/packages/mobx/CHANGELOG.md#700)).
- **`@xstate/store`** has had five majors since April 2024 (0.x, 1, 2, 3, 4). In
  version 4 the React hooks moved to a new package, `@xstate/store-react`, first
  published 2026-01-16
  ([`@xstate/store-react`](https://www.npmjs.com/package/@xstate/store-react)).
- **TanStack Store** is before 1.0 and has had four minor versions with API
  changes since October 2025 (0.8 to 0.11). 0.11 added `createStore` with an
  actions factory and `useSelector`.
- **Legend-State 3** has been in beta since 2024. Its docs tell users to install
  `@legendapp/state@beta`
  ([getting started](https://www.legendapp.com/open-source/state/v3/intro/getting-started/)),
  while npm's `latest` tag is still 2.1.15 from 2024. The v3 React hook is
  exported as `useValue`, `use$`, and `useSelector`, which are the same function
  (`@legendapp/state/react` type declarations).
- **Zustand 5**, **Valtio 2**, and **Redux Toolkit 2** have been the current
  majors for one to three years.

### Type safety

How state, actions, and selectors are typed in each example:

| Candidate                    | State                                    | Actions                                                                                                                                                                | Selectors                                                                                                           |
| ---------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Plain `useReducer` + context | Declared type                            | A union of action types, checked by the `switch`                                                                                                                       | Plain functions                                                                                                     |
| Plain `useSyncExternalStore` | Declared type                            | Plain functions                                                                                                                                                        | The `getSnapshot` function's return type                                                                            |
| Zustand                      | One interface declares state and actions | Declared in the interface; `create<T>()(...)` checks the implementation against it ([TypeScript guide](https://zustand.docs.pmnd.rs/learn/guides/beginner-typescript)) | Inferred from the selector                                                                                          |
| Jotai                        | Inferred per atom, or a type argument    | Write-only atoms; arguments typed in the write function                                                                                                                | Derived atoms, inferred                                                                                             |
| Valtio                       | Inferred from the initial object         | Plain functions that mutate the proxy                                                                                                                                  | `useSnapshot` returns a deeply readonly type ([useSnapshot](https://valtio.dev/docs/api/basic/useSnapshot))         |
| MobX                         | Class fields                             | Class methods                                                                                                                                                          | Class methods or getters                                                                                            |
| Redux Toolkit                | `initialState`'s type                    | `PayloadAction<T>` on each reducer; action creators inferred                                                                                                           | `useSelector.withTypes<RootState>()` ([TypeScript usage](https://redux-toolkit.js.org/usage/usage-with-typescript)) |
| `@xstate/store`              | Inferred from `context`                  | Event payloads typed on each handler; `store.trigger.<event>` inferred                                                                                                 | Inferred from the selector                                                                                          |
| Legend-State                 | Type argument to `observable`            | Plain functions calling `.set()` on observables                                                                                                                        | Inferred from the function passed to `useValue`                                                                     |
| Nanostores                   | Type argument to `map`                   | Plain functions                                                                                                                                                        | `useStore` returns the store's type                                                                                 |
| TanStack Store               | Inferred from the initial value          | Actions factory, inferred                                                                                                                                              | Inferred from the selector                                                                                          |
| Preact Signals               | Type argument to `signal`                | Plain functions assigning `.value`                                                                                                                                     | Reading `.value`                                                                                                    |

**What `tsc` caught.** Each probe file made these mistakes against its example:

1. Passing a number as a comment's body when editing.
2. Calling a misspelled action, such as `editDraf`.
3. Adding a comment without its `line`.
4. Mutating a comment read from state in a component or selector, such as
   `drafts['1'].body = 'x'`.
5. Assigning the whole record of comments to a `number`.

Mistakes 1, 2, 3, and 5 were reported for all twelve candidates. Mistake 4 was
only reported for Valtio, because `useSnapshot` returns readonly types. The
others accepted it.

**What happens at run time when read state is mutated** (mistake 4, run in
development mode):

| Result                                                 | Candidates                                                                                                                    |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Throws "Cannot assign to read only property"           | Valtio (snapshots are frozen, [snapshot](https://valtio.dev/docs/api/advanced/snapshot)), Redux Toolkit (Immer freezes state) |
| Changes the stored state without notifying subscribers | Zustand, Jotai, MobX, `@xstate/store`, Legend-State, Nanostores, TanStack Store, Preact Signals, plain `useSyncExternalStore` |

The plain `useReducer` example wasn't run this way, because its state is held
inside React.

MobX gave no warning for the mutation above because the comment wasn't being
observed. Its default `enforceActions: "observed"` only warns about changes
outside actions to state that something observes
([configuration](https://mobx.js.org/configuration.html#enforceactions)).

**A gap in Legend-State's types.** Indexing a record observable with a missing
key and setting a field, such as `drafts$['missing'].body.set('y')`, type-checks
and stores `{"missing":{"body":"y"}}`: a partial comment without `id`, `path`,
or `line`. The example guards against it with `peek()`.

### The same example in each candidate

Each example below defines comments in the
[draft review](../glossary.md#draft-review) keyed by ID, lets the reviewer add,
edit, and discard a comment, replaces all comments as an update pushed from the
review server would, and renders a `DraftCount` component that shows the number
of comments on a file. They all import this shared type, which isn't counted. It
simplifies a comment's [anchor](../glossary.md#anchor) to a path and line.

```ts
export interface Draft {
  id: string;
  path: string;
  line: number;
  body: string;
}
```

Lines are non-blank lines after formatting with Prettier at print width 100.

| Candidate                    | Lines | Lines without imports | `tsc`  | Ran    |
| ---------------------------- | ----: | --------------------: | ------ | ------ |
| Legend-State                 |    15 |                    12 | Passed | Passed |
| Nanostores                   |    16 |                    13 | Passed | Passed |
| Valtio                       |    20 |                    18 | Passed | Passed |
| Preact Signals               |    22 |                    19 | Passed | Passed |
| TanStack Store               |    24 |                    22 | Passed | Passed |
| Jotai                        |    25 |                    22 | Passed | Passed |
| `@xstate/store`              |    26 |                    24 | Passed | Passed |
| MobX                         |    27 |                    24 | Passed | Passed |
| Zustand                      |    28 |                    26 | Passed | Passed |
| Redux Toolkit                |    30 |                    27 | Passed | Passed |
| Plain `useSyncExternalStore` |    30 |                    28 | Passed | Passed |
| Plain `useReducer` + context |    45 |                    43 | Passed | Passed |

Not counted: Redux Toolkit needs a `<Provider store={store}>` at the root and
the `useReducer` example needs its `<DraftsProvider>`. The others need no
provider. The libraries that update immutably (plain React, Zustand, Jotai,
`@xstate/store`, TanStack Store, Preact Signals) spend most of their lines
copying objects. Zustand has an Immer middleware that allows mutating syntax
instead
([immer middleware](https://zustand.docs.pmnd.rs/reference/integrations/immer-middleware)),
which wasn't measured.

#### Plain React: `useReducer` and context

Based on
[Scaling up with reducer and context](https://react.dev/learn/scaling-up-with-reducer-and-context).

```tsx
import {
  createContext,
  useContext,
  useReducer,
  type Dispatch,
  type ReactNode,
} from 'react';
import type { Draft } from './types.ts';

type Drafts = Record<string, Draft>;
type Action =
  | { type: 'added'; draft: Draft }
  | { type: 'edited'; id: string; body: string }
  | { type: 'discarded'; id: string }
  | { type: 'replaced'; drafts: Draft[] };

export function reducer(drafts: Drafts, action: Action): Drafts {
  switch (action.type) {
    case 'added':
      return { ...drafts, [action.draft.id]: action.draft };
    case 'edited': {
      const draft = drafts[action.id];
      return draft
        ? { ...drafts, [action.id]: { ...draft, body: action.body } }
        : drafts;
    }
    case 'discarded': {
      const { [action.id]: _, ...rest } = drafts;
      return rest;
    }
    case 'replaced':
      return Object.fromEntries(action.drafts.map((d) => [d.id, d]));
  }
}

const DraftsContext = createContext<Drafts>({});
const DispatchContext = createContext<Dispatch<Action>>(() => {});
export const useDraftsDispatch = () => useContext(DispatchContext);

export function DraftsProvider({
  children,
  initial = {},
}: {
  children: ReactNode;
  initial?: Drafts;
}) {
  const [drafts, dispatch] = useReducer(reducer, initial);
  return (
    <DispatchContext value={dispatch}>
      <DraftsContext value={drafts}>{children}</DraftsContext>
    </DispatchContext>
  );
}

export function DraftCount({ path }: { path: string }) {
  const drafts = useContext(DraftsContext);
  return <>{Object.values(drafts).filter((d) => d.path === path).length}</>;
}
```

#### Plain React: `useSyncExternalStore`

Based on
[`useSyncExternalStore`](https://react.dev/reference/react/useSyncExternalStore).

```tsx
import { useSyncExternalStore } from 'react';
import type { Draft } from './types.ts';

let drafts: Readonly<Record<string, Draft>> = {};
const listeners = new Set<() => void>();
export const getDrafts = () => drafts;

function set(next: Record<string, Draft>) {
  drafts = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export const addDraft = (draft: Draft) => set({ ...drafts, [draft.id]: draft });
export function editDraft(id: string, body: string) {
  const draft = drafts[id];
  if (draft) set({ ...drafts, [id]: { ...draft, body } });
}
export function discardDraft(id: string) {
  const { [id]: _, ...rest } = drafts;
  set(rest);
}
export const replaceDrafts = (next: Draft[]) =>
  set(Object.fromEntries(next.map((d) => [d.id, d])));

export function DraftCount({ path }: { path: string }) {
  const count = useSyncExternalStore(
    subscribe,
    () => Object.values(drafts).filter((d) => d.path === path).length,
  );
  return <>{count}</>;
}
```

#### Zustand

Based on the
[beginner TypeScript guide](https://zustand.docs.pmnd.rs/learn/guides/beginner-typescript).

```tsx
import { create } from 'zustand';
import type { Draft } from './types.ts';

export interface DraftsState {
  drafts: Record<string, Draft>;
  addDraft: (draft: Draft) => void;
  editDraft: (id: string, body: string) => void;
  discardDraft: (id: string) => void;
  replaceDrafts: (drafts: Draft[]) => void;
}

export const useDrafts = create<DraftsState>()((set) => ({
  drafts: {},
  addDraft: (draft) =>
    set((s) => ({ drafts: { ...s.drafts, [draft.id]: draft } })),
  editDraft: (id, body) =>
    set((s) => {
      const draft = s.drafts[id];
      return draft ? { drafts: { ...s.drafts, [id]: { ...draft, body } } } : s;
    }),
  discardDraft: (id) =>
    set((s) => {
      const { [id]: _, ...rest } = s.drafts;
      return { drafts: rest };
    }),
  replaceDrafts: (drafts) =>
    set({ drafts: Object.fromEntries(drafts.map((d) => [d.id, d])) }),
}));

export function DraftCount({ path }: { path: string }) {
  const count = useDrafts(
    (s) => Object.values(s.drafts).filter((d) => d.path === path).length,
  );
  return <>{count}</>;
}
```

#### Jotai

Based on the [Jotai README](https://github.com/pmndrs/jotai#readme)'s write-only
and derived atoms. Outside React, the write-only atoms are called with
`store.set(addDraftAtom, draft)` on a
[store](https://jotai.org/docs/core/store).

```tsx
import { atom, useAtomValue } from 'jotai';
import { useMemo } from 'react';
import type { Draft } from './types.ts';

export const draftsAtom = atom<Record<string, Draft>>({});

export const addDraftAtom = atom(null, (get, set, draft: Draft) =>
  set(draftsAtom, { ...get(draftsAtom), [draft.id]: draft }),
);
export const editDraftAtom = atom(
  null,
  (get, set, id: string, body: string) => {
    const draft = get(draftsAtom)[id];
    if (draft)
      set(draftsAtom, { ...get(draftsAtom), [id]: { ...draft, body } });
  },
);
export const discardDraftAtom = atom(null, (get, set, id: string) => {
  const { [id]: _, ...rest } = get(draftsAtom);
  set(draftsAtom, rest);
});
export const replaceDraftsAtom = atom(null, (_get, set, drafts: Draft[]) =>
  set(draftsAtom, Object.fromEntries(drafts.map((d) => [d.id, d]))),
);

export function DraftCount({ path }: { path: string }) {
  const countAtom = useMemo(
    () =>
      atom(
        (get) =>
          Object.values(get(draftsAtom)).filter((d) => d.path === path).length,
      ),
    [path],
  );
  return <>{useAtomValue(countAtom)}</>;
}
```

#### Valtio

Based on [`proxy`](https://valtio.dev/docs/api/basic/proxy) and
[`useSnapshot`](https://valtio.dev/docs/api/basic/useSnapshot).

```tsx
import { proxy, useSnapshot } from 'valtio';
import type { Draft } from './types.ts';

export const state = proxy({ drafts: {} as Record<string, Draft> });

export const addDraft = (draft: Draft) => {
  state.drafts[draft.id] = draft;
};
export const editDraft = (id: string, body: string) => {
  const draft = state.drafts[id];
  if (draft) draft.body = body;
};
export const discardDraft = (id: string) => {
  delete state.drafts[id];
};
export const replaceDrafts = (drafts: Draft[]) => {
  state.drafts = Object.fromEntries(drafts.map((d) => [d.id, d]));
};

export function DraftCount({ path }: { path: string }) {
  const snap = useSnapshot(state);
  return (
    <>{Object.values(snap.drafts).filter((d) => d.path === path).length}</>
  );
}
```

#### MobX

Based on [React integration](https://mobx.js.org/react-integration.html). MobX
state is read in components wrapped in `observer`, so this example exports a
component rather than a hook.

```tsx
import { makeAutoObservable, observable } from 'mobx';
import { observer } from 'mobx-react-lite';
import type { Draft } from './types.ts';

export class DraftsStore {
  drafts = observable.map<string, Draft>();
  constructor() {
    makeAutoObservable(this);
  }
  add(draft: Draft) {
    this.drafts.set(draft.id, draft);
  }
  edit(id: string, body: string) {
    const draft = this.drafts.get(id);
    if (draft) draft.body = body;
  }
  discard(id: string) {
    this.drafts.delete(id);
  }
  replace(drafts: Draft[]) {
    this.drafts.replace(drafts.map((d) => [d.id, d]));
  }
  count(path: string) {
    return [...this.drafts.values()].filter((d) => d.path === path).length;
  }
}

export const drafts = new DraftsStore();

export const DraftCount = observer(({ path }: { path: string }) => (
  <>{drafts.count(path)}</>
));
```

A first attempt declared `drafts = new Map<string, Draft>()`, which
`makeAutoObservable` makes observable at run time. `tsc` rejected
`this.drafts.replace`, because the field's type is still `Map`, so the example
uses `observable.map`.

#### Redux Toolkit

Based on [`createSlice`](https://redux-toolkit.js.org/api/createSlice) and
[TypeScript usage](https://redux-toolkit.js.org/usage/usage-with-typescript).
`createEntityAdapter` provides `addOne`, `updateOne`, `removeOne`, and `setAll`
reducers for collections like this one
([`createEntityAdapter`](https://redux-toolkit.js.org/api/createEntityAdapter)),
which wasn't measured.

```tsx
import {
  configureStore,
  createSlice,
  type PayloadAction,
} from '@reduxjs/toolkit';
import { useSelector } from 'react-redux';
import type { Draft } from './types.ts';

const draftsSlice = createSlice({
  name: 'drafts',
  initialState: {} as Record<string, Draft>,
  reducers: {
    added(state, action: PayloadAction<Draft>) {
      state[action.payload.id] = action.payload;
    },
    edited(state, action: PayloadAction<{ id: string; body: string }>) {
      const draft = state[action.payload.id];
      if (draft) draft.body = action.payload.body;
    },
    discarded(state, action: PayloadAction<string>) {
      delete state[action.payload];
    },
    replaced: (_state, action: PayloadAction<Draft[]>) =>
      Object.fromEntries(action.payload.map((d) => [d.id, d])),
  },
});

export const { added, edited, discarded, replaced } = draftsSlice.actions;
export const store = configureStore({
  reducer: { drafts: draftsSlice.reducer },
});
const useAppSelector =
  useSelector.withTypes<ReturnType<typeof store.getState>>();

export function DraftCount({ path }: { path: string }) {
  const count = useAppSelector(
    (s) => Object.values(s.drafts).filter((d) => d.path === path).length,
  );
  return <>{count}</>;
}
```

#### `@xstate/store`

Based on the
[`@xstate/store` README](https://github.com/statelyai/xstate/tree/main/packages/xstate-store)
and [React docs](https://stately.ai/docs/xstate-store/react). Handlers return
the next context. Returning `undefined` marks the event as not allowed, so
`edited` returns `ctx` for a missing comment.

```tsx
import { createStore, useSelector } from '@xstate/store-react';
import type { Draft } from './types.ts';

export const draftsStore = createStore({
  context: { drafts: {} as Record<string, Draft> },
  on: {
    added: (ctx, e: { draft: Draft }) => ({
      drafts: { ...ctx.drafts, [e.draft.id]: e.draft },
    }),
    edited: (ctx, e: { id: string; body: string }) => {
      const draft = ctx.drafts[e.id];
      return draft
        ? { drafts: { ...ctx.drafts, [e.id]: { ...draft, body: e.body } } }
        : ctx;
    },
    discarded: (ctx, e: { id: string }) => {
      const { [e.id]: _, ...rest } = ctx.drafts;
      return { drafts: rest };
    },
    replaced: (_ctx, e: { drafts: Draft[] }) => ({
      drafts: Object.fromEntries(e.drafts.map((d) => [d.id, d])),
    }),
  },
});

export function DraftCount({ path }: { path: string }) {
  const count = useSelector(
    draftsStore,
    (s) =>
      Object.values(s.context.drafts).filter((d) => d.path === path).length,
  );
  return <>{count}</>;
}
```

#### Legend-State

Based on the v3
[observable](https://www.legendapp.com/open-source/state/v3/usage/observable/)
and
[getting started](https://www.legendapp.com/open-source/state/v3/intro/getting-started/)
docs.

```tsx
import { observable } from '@legendapp/state';
import { useValue } from '@legendapp/state/react';
import type { Draft } from './types.ts';

export const drafts$ = observable<Record<string, Draft>>({});

export const addDraft = (draft: Draft) => drafts$[draft.id].set(draft);
export const editDraft = (id: string, body: string) => {
  if (drafts$[id].peek()) drafts$[id].body.set(body);
};
export const discardDraft = (id: string) => drafts$[id].delete();
export const replaceDrafts = (drafts: Draft[]) =>
  drafts$.set(Object.fromEntries(drafts.map((d) => [d.id, d])));

export function DraftCount({ path }: { path: string }) {
  const count = useValue(
    () => Object.values(drafts$.get()).filter((d) => d.path === path).length,
  );
  return <>{count}</>;
}
```

#### Nanostores

Based on the [Nanostores README](https://github.com/nanostores/nanostores) and
[Nanostores React](https://github.com/nanostores/react).

```tsx
import { map } from 'nanostores';
import { useStore } from '@nanostores/react';
import type { Draft } from './types.ts';

export const $drafts = map<Record<string, Draft>>({});

export const addDraft = (draft: Draft) => $drafts.setKey(draft.id, draft);
export const editDraft = (id: string, body: string) => {
  const draft = $drafts.get()[id];
  if (draft) $drafts.setKey(id, { ...draft, body });
};
export const discardDraft = (id: string) => $drafts.setKey(id, undefined);
export const replaceDrafts = (drafts: Draft[]) =>
  $drafts.set(Object.fromEntries(drafts.map((d) => [d.id, d])));

export function DraftCount({ path }: { path: string }) {
  const drafts = useStore($drafts);
  return <>{Object.values(drafts).filter((d) => d.path === path).length}</>;
}
```

#### TanStack Store

Based on the
[React quick start](https://tanstack.com/store/latest/docs/framework/react/quick-start)
and the 0.11.2 type declarations.

```tsx
import { createStore, useSelector } from '@tanstack/react-store';
import type { Draft } from './types.ts';

export const draftsStore = createStore(
  { drafts: {} as Record<string, Draft> },
  ({ setState }) => ({
    add: (draft: Draft) =>
      setState((s) => ({ drafts: { ...s.drafts, [draft.id]: draft } })),
    edit: (id: string, body: string) =>
      setState((s) => {
        const draft = s.drafts[id];
        return draft
          ? { drafts: { ...s.drafts, [id]: { ...draft, body } } }
          : s;
      }),
    discard: (id: string) =>
      setState((s) => {
        const { [id]: _, ...rest } = s.drafts;
        return { drafts: rest };
      }),
    replace: (drafts: Draft[]) =>
      setState(() => ({
        drafts: Object.fromEntries(drafts.map((d) => [d.id, d])),
      })),
  }),
);

export function DraftCount({ path }: { path: string }) {
  const count = useSelector(
    draftsStore,
    (s) => Object.values(s.drafts).filter((d) => d.path === path).length,
  );
  return <>{count}</>;
}
```

#### Preact Signals

Based on the
[`@preact/signals-react` README](https://github.com/preactjs/signals/tree/main/packages/react).
This uses the `useSignals` hook. The README's recommended setup is a Babel
transform that adds it to components automatically.

```tsx
import { signal } from '@preact/signals-react';
import { useSignals } from '@preact/signals-react/runtime';
import type { Draft } from './types.ts';

export const drafts = signal<Readonly<Record<string, Draft>>>({});

export const addDraft = (draft: Draft) => {
  drafts.value = { ...drafts.value, [draft.id]: draft };
};
export const editDraft = (id: string, body: string) => {
  const draft = drafts.value[id];
  if (draft) drafts.value = { ...drafts.value, [id]: { ...draft, body } };
};
export const discardDraft = (id: string) => {
  const { [id]: _, ...rest } = drafts.value;
  drafts.value = rest;
};
export const replaceDrafts = (next: Draft[]) => {
  drafts.value = Object.fromEntries(next.map((d) => [d.id, d]));
};

export function DraftCount({ path }: { path: string }) {
  useSignals();
  return (
    <>{Object.values(drafts.value).filter((d) => d.path === path).length}</>
  );
}
```

### Replacing state with updates pushed from the review server

Every candidate except plain `useReducer` can be updated from outside React, so
an `EventSource` handler can write to it directly, and can read current state
without the prototype's `useRef` workaround:

| Candidate                    | Replace state from a server event                                                                                     | Read current state outside React     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Plain `useReducer` + context | Only through `dispatch`, so the handler must live in or be wired up from a component                                  | No                                   |
| Plain `useSyncExternalStore` | Call the module's setter                                                                                              | Read the module variable             |
| Zustand                      | `useDrafts.setState(...)` or an action from `getState()`                                                              | `useDrafts.getState()`               |
| Jotai                        | `store.set(atom, value)` on a [store](https://jotai.org/docs/core/store) passed to `<Provider>`, or the default store | `store.get(atom)`                    |
| Valtio                       | Assign to the proxy                                                                                                   | Read the proxy, or `snapshot(state)` |
| MobX                         | Call an action; `ObservableMap.replace`                                                                               | Read the observable                  |
| Redux Toolkit                | `store.dispatch(replaced(...))`; `createEntityAdapter`'s `setAll`                                                     | `store.getState()`                   |
| `@xstate/store`              | `store.trigger.replaced(...)`                                                                                         | `store.getSnapshot()`                |
| Legend-State                 | `drafts$.set(...)`                                                                                                    | `drafts$.peek()`                     |
| Nanostores                   | `$drafts.set(...)`                                                                                                    | `$drafts.get()`                      |
| TanStack Store               | `store.actions.replace(...)` or `setState`                                                                            | `store.state`                        |
| Preact Signals               | Assign `drafts.value`                                                                                                 | `drafts.peek()` or `.value`          |

**What re-renders.** The run measured how often `DraftCount` re-rendered when
one comment's body was edited, which doesn't change the count, and when the
review server pushed comments equal to the current ones, as new objects:

| Candidate                                                                                                          | Body edit | Equal update pushed |
| ------------------------------------------------------------------------------------------------------------------ | --------: | ------------------: |
| Plain `useReducer` + context                                                                                       |         1 |                   1 |
| Nanostores (`useStore` on the whole map)                                                                           |         1 |                   1 |
| Preact Signals                                                                                                     |         1 |                   1 |
| MobX                                                                                                               |         0 |                   1 |
| Plain `useSyncExternalStore`, Zustand, Jotai, Valtio, Redux Toolkit, `@xstate/store`, Legend-State, TanStack Store |         0 |                   0 |

- Libraries whose read takes a selector or derived value
  (`useSyncExternalStore`, Zustand, Jotai, Redux Toolkit, `@xstate/store`,
  Legend-State's `useValue(() => ...)`, TanStack Store) compare the selected
  number and skip the render when it's unchanged.
- Valtio skipped both renders without a selector, because `useSnapshot` tracks
  which properties the render read, here each comment's `path`
  ([useSnapshot](https://valtio.dev/docs/api/basic/useSnapshot)).
- MobX's `ObservableMap.replace` stores the new comment objects, so the
  `observer` component re-rendered even though the content was equal.
- Context, Nanostores' `useStore`, and the signal holding the whole record
  re-render whenever the record changes. Nanostores can narrow this with
  `computed` stores, and Signals with `computed`, at the cost of more code.

Replacing state with new objects also changes the identity of every comment. A
component that selects one comment object, rather than a number, would re-render
on each pushed update in every candidate unless it compares by value, such as
Zustand's `useShallow`
([useShallow](https://zustand.docs.pmnd.rs/reference/hooks/use-shallow)). This
wasn't measured. Legend-State's docs describe applying server data through its
sync plugins
([TanStack Query plugin](https://www.legendapp.com/open-source/state/v3/sync/tanstack-query/)).

### Easy for agents to work in

| Candidate       | Ways to define state                                                                                                                                                                   | Hidden behavior                                                                                                                                                                                | `llms.txt`                                                                                                  | Testing without rendering                                                                               | npm downloads, week of 2026-10-05 |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------: |
| Plain React     | `useState`, `useReducer`, context, `useSyncExternalStore`                                                                                                                              | None beyond React's                                                                                                                                                                            | [Yes](https://react.dev/llms.txt)                                                                           | Reducers are pure functions; context state needs rendering                                              |                                 — |
| Zustand         | One: `create` with state and actions together; slices and middleware are optional ([slices](https://zustand.docs.pmnd.rs/learn/guides/slices-pattern))                                 | Selectors returning new objects or arrays cause re-renders unless wrapped in `useShallow`                                                                                                      | [Yes](https://zustand.docs.pmnd.rs/llms.txt), plus `llms-full.txt`                                          | `getState()` and actions are plain calls ([testing](https://zustand.docs.pmnd.rs/learn/guides/testing)) |                        62,525,244 |
| Jotai           | Many atom kinds: primitive, derived, write-only, and `jotai/utils` helpers                                                                                                             | Atoms are config objects; their values live in a store, and the default store is used outside a `<Provider>` ([atom](https://jotai.org/docs/core/atom))                                        | No (404)                                                                                                    | `createStore()`, then `store.get` and `store.set` ([testing](https://jotai.org/docs/guides/testing))    |                         6,793,760 |
| Valtio          | One: `proxy`                                                                                                                                                                           | Proxies and render tracking (`proxy-compare`); mutating the snapshot instead of the proxy is a common mistake, caught by the readonly types                                                    | No (404)                                                                                                    | Mutate the proxy and read it                                                                            |                         2,116,074 |
| MobX            | Classes with `makeAutoObservable`, `makeObservable`, Stage 3 decorators, or `observable({...})` ([CHANGELOG](https://github.com/mobxjs/mobx/blob/main/packages/mobx/CHANGELOG.md#700)) | Proxies, implicit dependency tracking, and `observer`; components not wrapped in `observer` silently don't update                                                                              | No (404)                                                                                                    | Call methods and read fields                                                                            |                         3,809,223 |
| Redux Toolkit   | One main way: `createSlice` and `configureStore`                                                                                                                                       | Immer recipes in reducers: mutate _or_ return, never both ([Immer reducers](https://redux-toolkit.js.org/usage/immer-reducers))                                                                | No (404 on [redux.js.org](https://redux.js.org/) and [redux-toolkit.js.org](https://redux-toolkit.js.org/)) | Reducers are pure; `store.dispatch` and `getState`                                                      |                        33,582,978 |
| `@xstate/store` | One: `createStore` with `context` and `on`                                                                                                                                             | Returning `undefined` from a handler rejects the event                                                                                                                                         | Yes, on the [Stately site](https://stately.ai/llms.txt)                                                     | `store.trigger.*` and `getSnapshot()`                                                                   |                           212,002 |
| Legend-State    | Observables, computed functions inside observables, `useObservable`, reactive components                                                                                               | Proxies; fine-grained tracking; `get()` vs `peek()` decides tracking                                                                                                                           | [Yes (v3)](https://www.legendapp.com/open-source/state/v3/llms.txt)                                         | `.set` and `.peek()`                                                                                    |                           126,693 |
| Nanostores      | `atom`, `map`, `computed`, and more                                                                                                                                                    | Few; `onMount` callbacks run when a store gets its first subscriber ([lazy stores](https://github.com/nanostores/nanostores#lazy-stores))                                                      | No (404)                                                                                                    | `.set` and `.get()`                                                                                     |                        12,417,034 |
| TanStack Store  | `createStore` (with or without actions), `createAtom`                                                                                                                                  | Few                                                                                                                                                                                            | [Yes](https://tanstack.com/store/latest/llms.txt)                                                           | `store.actions.*` and `store.state`                                                                     |                        28,941,303 |
| Preact Signals  | `signal`, `computed`, `effect`                                                                                                                                                         | Components need the Babel transform or `useSignals()`; the transform can miss components that read signals indirectly ([README](https://github.com/preactjs/signals/tree/main/packages/react)) | [Yes](https://preactjs.com/llms.txt) (Preact site)                                                          | `.value` reads and writes                                                                               |                           299,313 |

Downloads come from the npm downloads API and are only a rough guide to how well
each API is represented in training data. `@tanstack/store` is a dependency of
other TanStack libraries, such as TanStack Form (`@tanstack/form-core` depends
on `@tanstack/store` `^0.11.0`), so its count doesn't measure direct use. The
`llms.txt` column was checked with `curl` on 2026-10-13 against each docs site's
root.

Agent-relevant observations from writing the examples:

- **Changed APIs.** The examples for Jotai 3, MobX 7, `@xstate/store` 4,
  TanStack Store 0.11, and Legend-State 3 had to be written from the installed
  type declarations and current docs, since these versions are newer than much
  of the code an agent will have seen. For example, `@xstate/store`'s React
  hooks are now imported from `@xstate/store-react`, and TanStack Store's
  `createStore` actions factory is new in 0.11.
- **Only MobX's example failed `tsc` on the first try**, for the `Map` field
  described in its section.
- **Legend-State's record indexing** hides a missing-key case that the types
  don't catch, described in [Type safety](#type-safety).

### Working alongside CodeMirror and data-fetching libraries

- None of the candidates holds CodeMirror's `EditorState`. Each can hold the
  values CodeMirror is configured from, such as the selected line, and an effect
  or CodeMirror extension pushes changes into the editor.
- Jotai has an official TanStack Query integration
  ([jotai-tanstack-query](https://jotai.org/docs/extensions/query)), and
  Legend-State has a sync plugin for it
  ([TanStack Query plugin](https://www.legendapp.com/open-source/state/v3/sync/tanstack-query/)).
- Redux Toolkit includes its own data-fetching layer, RTK Query, in the same
  package ([RTK Query](https://redux-toolkit.js.org/rtk-query/overview)).
- The others have no specific integration. They sit next to a data-fetching
  library, which would hold data loaded from the review server while the state
  library holds the reviewer's UI state and the draft review.

## Options

### A. Plain React: `useReducer`, context, and `useSyncExternalStore`

Benefits:

- No dependency and no size cost.
- The best-known API, with `llms.txt` docs.
- Reducers are pure functions that can be tested without rendering.

Costs:

- The most code: 45 lines with `useReducer` and context, 30 with
  `useSyncExternalStore`.
- Context re-renders every consumer on any change (1 render for a body edit and
  for an equal pushed update).
- State held by `useReducer` can't be written from an `EventSource` handler
  outside React, which is what led to the prototype's `useRef` handler.
- Several ways to do the same thing, so conventions have to be written down.

### B. Zustand

Benefits:

- 406 bytes.
- One main pattern, the most downloaded candidate, and `llms.txt` docs.
- State is read and written outside React with `getState` and `setState`, and
  selectors skipped both re-renders.
- Stable: version 5 since October 2024.

Costs:

- 28 lines, with state and actions declared in an interface and again in the
  implementation.
- Immutable updates copy objects by hand unless the Immer middleware is added.
- Read state isn't readonly; mutating it is silent at run time and isn't caught
  by `tsc`.
- Selectors that return new objects need `useShallow` to avoid re-renders.

### C. Jotai

Benefits:

- 3.2 KB, with fine-grained atoms and derived atoms.
- Atoms can be tested through `createStore()` without rendering.
- An official TanStack Query integration.

Costs:

- Many kinds of atoms, so less of "one obvious way."
- Per-file derived atoms need `useMemo` or a helper.
- No `llms.txt`, and version 3 is a month old.
- Read state isn't readonly.

### D. Valtio

Benefits:

- 2.5 KB and 20 lines, with mutating syntax.
- The only candidate whose types reject mutating read state, and whose snapshots
  throw when mutated at run time.
- Render tracking skipped both re-renders without a selector.

Costs:

- Proxies and render tracking are hidden behavior. Mutating the proxy and
  reading the snapshot are two different objects, which is easy to mix up.
- No `llms.txt`, and 4 stable releases in the last year.

### E. MobX

Benefits:

- Methods mutate state directly, with automatic dependency tracking.
- Large existing user base.

Costs:

- The largest for the example's imports, at 13.6 KB (Redux Toolkit is larger as
  a whole package).
- The most hidden behavior: proxies, implicit tracking, and `observer`. A
  component that isn't wrapped in `observer` doesn't update.
- Mutation outside actions only warns when the state is observed.
- MobX 7 is from July 2026 and renamed several APIs.
- `ObservableMap.replace` re-rendered on an equal pushed update.
- No `llms.txt`.

### F. Redux Toolkit

Benefits:

- One main pattern, well documented, and the second most downloaded.
- State is frozen in development, so mutating read state throws.
- Reducers are pure and testable; `createEntityAdapter` fits collections such as
  the draft review's comments, and RTK Query is included if needed.
- Stable: version 2 since December 2023.

Costs:

- 10.5 KB for the example, 19.4 KB for the whole package.
- 30 lines, plus a `<Provider>`.
- No `llms.txt`.

### G. `@xstate/store`

Benefits:

- 3.2 KB. Event payload types are inferred from the handlers, and
  `store.trigger.<event>` is typed.
- An `llms.txt` on the Stately site.
- Can grow into XState state machines.

Costs:

- Five majors since April 2024, and its React hooks moved to a new package in
  2026, so agents' training data is likely out of date.
- 26 lines, with manual immutable updates.
- Returning `undefined` from a handler silently rejects the event.
- Few downloads (212,002 a week).

### H. Legend-State

Benefits:

- The fewest lines (15), with fine-grained reactivity that skipped both
  re-renders.
- `llms.txt` docs for version 3, and a TanStack Query sync plugin.

Costs:

- Version 3, which the docs use, has been in beta since 2024. The `latest`
  stable release is 2.1.15 from August 2024.
- 12.1 KB.
- Missing record keys aren't caught by the types: setting a field on a missing
  comment created a partial comment.
- Proxies and the `get()` versus `peek()` distinction are hidden behavior.
- Few downloads (126,693 a week).

### I. Nanostores

Benefits:

- 1.1 KB and 16 lines.
- Small API with little hidden behavior. Stores are plain objects with `get`,
  `set`, and `subscribe`.

Costs:

- `useStore` on a whole map re-renders on every change; narrowing it needs
  `computed` stores.
- No `llms.txt`; the docs are a README.
- `@nanostores/react` 2.0 is from September 2026.

### J. TanStack Store

Benefits:

- 3.0 KB and 24 lines, with actions and selectors inferred.
- `llms.txt` docs, and used inside other TanStack libraries.

Costs:

- Before 1.0, with API changes in four minor versions in the last year and a 1.0
  alpha published.
- Manual immutable updates.
- Read state isn't readonly.

### K. Preact Signals

Benefits:

- 3.3 KB and 22 lines.
- Signals can be read and written anywhere.

Costs:

- Components need a Babel transform or a `useSignals()` call. The transform can
  miss components that read signals indirectly.
- A signal holding the whole record re-renders on every change unless `computed`
  is used.
- Read state isn't readonly.

## Gaps

- **Checked by hand:** all twelve examples passed `tsc` (TypeScript 7.0.2), the
  five type-checker probes, the run in happy-dom with React 19.3.0, the run-time
  mutation check, and the size measurements, as described in
  [How the candidates were checked](#how-the-candidates-were-checked). The
  examples, probes, and harness were in a scratch directory and weren't
  committed.
- **Not checked in a browser.** The examples ran in happy-dom, not in a real
  browser or the prototype.
- **Bigger examples.** Only comments in the draft review were modelled. The diff
  mode, file view, selection, and data loaded from the review server weren't, so
  how each candidate scales to the review UI's full state, and how state is
  split between stores or atoms, wasn't compared.
- **Selecting objects after a pushed update.** Re-renders were only measured for
  a component that selects a number. Components that select a comment object
  after the review server replaces state weren't measured.
- **Variants not measured.** Zustand's Immer middleware, Redux Toolkit's
  `createEntityAdapter`, Nanostores' `computed`, and the Preact Signals Babel
  transform would change the line counts and re-render results.
- **Other size tools.** Bundlephobia and similar sites weren't checked. Sizes
  come from the esbuild measurement only.
- **React Compiler** compatibility wasn't checked.
- **How well agents know each API** wasn't measured. Download counts and release
  dates are used as a rough guide.
- **Other candidates** such as MobX-State-Tree, Effector, and Zedux weren't
  covered.
