# 0003: How do Zustand and TanStack Store work with Immer, and which stores infer their own types?

- Date: 2026-10-14

## Question

[0002](0002-react-state-management.md) compared state management libraries for
the [review UI](../glossary.md#review-ui). While reading it, Dan asked follow-up
questions:

- What do Zustand and Immer look like together?
- Does a Zustand store need its type declared, as in `create<DraftsState>()`, or
  can it be inferred from methods with typed parameters, such as
  `addDraft(draft: Draft)`?
- Which other libraries with a similar API support that style?
- What does TanStack Store look like with Immer, with a small helper that hides
  `produce`, and with a generic version of that helper for every store?

This research answers those questions with the same drafts example as 0002. It
doesn't choose a library.

## Findings

### How the examples were checked

The checks follow
[0002's method](0002-react-state-management.md#how-the-candidates-were-checked),
run on 2026-10-14 in a scratch directory outside the repo, on Node 26.11.1 with
React and React DOM 19.3.0, `@types/react` 19, TypeScript 7.0.2, esbuild 0.28.2,
and Prettier 3.9.10. The repo's dependencies weren't changed. Library versions
are the ones 0002 checked, plus Immer 11.1.21: `zustand` 5.0.15,
`@tanstack/react-store` 0.11.2, `@xstate/store` 4.3.0 with `@xstate/store-react`
2.1.0, `@reduxjs/toolkit` 2.13.0 with `react-redux` 9.3.0, `valtio` 2.3.2,
`mobx` 7.0.6 with `mobx-react-lite` 5.1.0, and `@legendapp/state` 3.0.0-beta.48.

- **The examples** use the shared `Draft` type from 0002. Unlike 0002's
  examples, each store has a `count(path)` method, and `DraftCount` calls it.
  Lines are non-blank lines after Prettier at print width 80 with single quotes,
  the repo's Markdown settings, so the counts match the code shown here. 0002
  counted lines at print width 100, so its counts can't be compared with these.
  Its code blocks were reformatted at width 80 after it was merged, so they no
  longer have the line counts it reports.
- **Type-checker probes.** For each example, `tsc` was run on a file that passes
  a number as a draft's body, calls a misspelled action, adds a draft without
  its `line`, mutates a draft read from the store, and assigns `count`'s result
  to a `string`.
- **Running the examples.** Each example was bundled with esbuild and run in
  Node with happy-dom, in development mode. A test mounted
  `<DraftCount path="a.ts" />` with `react-dom/client` and `act`, then added
  three drafts, edited one, discarded one, replaced them all as a pushed update
  would, edited a draft that doesn't exist, and pushed an update equal to the
  current state, checking the rendered count and the stored drafts after each
  step. A `Profiler` counted how often `DraftCount` re-rendered. Last, it
  mutated a draft read from the store.
- **Size** is measured as in 0002: the functions an example imports are bundled
  with esbuild, minified, with React external, then compressed with `gzip -9`.
  Immer is included.

### Results

| Example                                                                              | Size (bytes, gzip) |                      Lines | Store type declared | `tsc` catches mutating read state | Mutating read state at run time | `DraftCount` re-renders (body edit / equal push) |
| ------------------------------------------------------------------------------------ | -----------------: | -------------------------: | ------------------- | --------------------------------- | ------------------------------- | ------------------------------------------------ |
| [Zustand](#zustand)                                                                  |                391 |                         33 | Yes, an interface   | No                                | Silently changes state          | 0 / 0                                            |
| [Zustand + Immer](#zustand-with-immer)                                               |              4,160 |                         39 | Yes, an interface   | No                                | Throws                          | 0 / 0                                            |
| [Zustand + Immer + `combine`](#inferring-a-zustand-stores-type)                      |              4,184 |                         39 | No                  | No                                | Throws                          | 0 / 0                                            |
| [TanStack Store](#tanstack-store)                                                    |              2,998 |                         36 | No                  | No                                | Silently changes state          | 0 / 0                                            |
| [TanStack Store + `produce`](#tanstack-store-with-immer)                             |              6,637 |                         44 | No                  | No                                | Throws                          | 0 / 0                                            |
| [TanStack Store + `createImmerStore`](#a-createimmerstore-helper-for-tanstack-store) |              6,675 | 32, plus 31 for the helper | No                  | Yes                               | Throws                          | 0 / 0                                            |

Every example passed `tsc`, every step of the run, and caught the other four
probes: the wrong body type, the misspelled action, the missing `line`, and
assigning `count`'s result to a `string`. Immer itself is 3,812 bytes of each
Immer size. Sizes differ by a few bytes from 0002's for the same libraries
because these examples import slightly different functions.

### Zustand

0002's example, with the count moved into the store. `count` reads the store
with `get()`, and `DraftCount` calls it inside its selector, so the component
still only re-renders when the number changes.

```tsx
import { create } from 'zustand';
import type { Draft } from './types.ts';

export interface DraftsState {
  drafts: Record<string, Draft>;
  addDraft: (draft: Draft) => void;
  editDraft: (id: string, body: string) => void;
  discardDraft: (id: string) => void;
  replaceDrafts: (drafts: Draft[]) => void;
  count: (path: string) => number;
}

export const useDrafts = create<DraftsState>()((set, get) => ({
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
  count: (path) =>
    Object.values(get().drafts).filter((d) => d.path === path).length,
}));

export function DraftCount({ path }: { path: string }) {
  const count = useDrafts((s) => s.count(path));
  return <>{count}</>;
}
```

### Zustand with Immer

Zustand's `immer` middleware lets `set` take a function that changes the state
in place
([immer middleware](https://zustand.docs.pmnd.rs/reference/integrations/immer-middleware)).
Immer is a separate install; `zustand` 5.0.15 lists `immer` `>=9.0.6` as an
optional peer dependency.

```tsx
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Draft } from './types.ts';

export interface DraftsState {
  drafts: Record<string, Draft>;
  addDraft: (draft: Draft) => void;
  editDraft: (id: string, body: string) => void;
  discardDraft: (id: string) => void;
  replaceDrafts: (drafts: Draft[]) => void;
  count: (path: string) => number;
}

export const useDrafts = create<DraftsState>()(
  immer((set, get) => ({
    drafts: {},
    addDraft: (draft) =>
      set((s) => {
        s.drafts[draft.id] = draft;
      }),
    editDraft: (id, body) =>
      set((s) => {
        const draft = s.drafts[id];
        if (draft) draft.body = body;
      }),
    discardDraft: (id) =>
      set((s) => {
        delete s.drafts[id];
      }),
    replaceDrafts: (drafts) =>
      set((s) => {
        s.drafts = Object.fromEntries(drafts.map((d) => [d.id, d]));
      }),
    count: (path) =>
      Object.values(get().drafts).filter((d) => d.path === path).length,
  })),
);

export function DraftCount({ path }: { path: string }) {
  const count = useDrafts((s) => s.count(path));
  return <>{count}</>;
}
```

- **Fewer copies, not fewer lines.** Each update is a plain assignment or
  `delete`, with no spreading. Prettier puts each `set((s) => { ... })` on
  several lines, so the example is 6 lines longer than without Immer.
- **Frozen state.** Immer freezes the state it produces
  ([auto freezing](https://immerjs.github.io/immer/freezing)), so mutating a
  draft read from the store threw "Cannot assign to read only property" instead
  of silently changing it, as in Redux Toolkit.
- **Objects passed in are frozen too.** After `addDraft(draft)`, the caller's
  `draft` object was frozen. Code that keeps a reference and changes it later
  would throw.
- **Mutate or return.** A recipe must either change the state or return a new
  one, not both ([returning new data](https://immerjs.github.io/immer/return)).

### Inferring a Zustand store's type

Without a declared type, Zustand can't infer the store's type, with or without
Immer and with or without the extra `()` after `create`:

```tsx
export const useDrafts = create()(
  immer((set, get) => ({
    drafts: {} as Record<string, Draft>,
    addDraft(draft: Draft) {
      set((s) => {
        s.drafts[draft.id] = draft;
      });
    },
    count(path: string) {
      return Object.values(get().drafts).filter((d) => d.path === path).length;
    },
  })),
);
```

`tsc` reported that `s` implicitly has an `any` type and that `get()` returns
`unknown`. The types of `set` and `get` depend on the object being returned, and
that object uses them, so TypeScript can't resolve the state's type.

The `combine` middleware takes the initial state as a separate argument, so its
type is known before the methods are read
([combine](https://zustand.docs.pmnd.rs/reference/middlewares/combine)):

```tsx
import { create } from 'zustand';
import { combine } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { Draft } from './types.ts';

export const useDrafts = create(
  immer(
    combine({ drafts: {} as Record<string, Draft> }, (set, get) => ({
      addDraft(draft: Draft) {
        set((s) => {
          s.drafts[draft.id] = draft;
        });
      },
      editDraft(id: string, body: string) {
        set((s) => {
          const draft = s.drafts[id];
          if (draft) draft.body = body;
        });
      },
      discardDraft(id: string) {
        set((s) => {
          delete s.drafts[id];
        });
      },
      replaceDrafts(drafts: Draft[]) {
        set((s) => {
          s.drafts = Object.fromEntries(drafts.map((d) => [d.id, d]));
        });
      },
      count(path: string) {
        return Object.values(get().drafts).filter((d) => d.path === path)
          .length;
      },
    })),
  ),
);

export function DraftCount({ path }: { path: string }) {
  const count = useDrafts((s) => s.count(path));
  return <>{count}</>;
}
```

This passed every check. `tsc` errors name a generated type instead of an
interface, for example
`Property 'editDraf' does not exist on type 'Write<{ drafts: Record<string, Draft>; }, { addDraft(draft: Draft): void; ... }>'`,
and there's no exported type for the store unless one is written with
`ReturnType<typeof useDrafts.getState>`.

### Inferring the store's type in other libraries

The same style, with no declared store type and methods with typed parameters,
was written for six libraries with a store-like API. All six passed `tsc`,
caught the wrong body type, the misspelled action, the missing `line`, and
assigning `count`'s result to a `string`, and passed every step of the run.

| Library         | How state and methods are written                                                                                                     | Where `count` lives                                              | `DraftCount` re-renders (body edit / equal push) |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------ |
| TanStack Store  | Initial state, then an actions factory given `{ setState, get }`                                                                      | An action                                                        | 0 / 0                                            |
| `@xstate/store` | `context`, then handlers with typed payloads, which can use method syntax                                                             | A separate function; `createStore` has no place for read methods | 0 / 0                                            |
| Redux Toolkit   | `createSlice` with method reducers ([createSlice](https://redux-toolkit.js.org/api/createSlice))                                      | The slice's `selectors` field                                    | 0 / 0                                            |
| Valtio          | Methods on the object passed to `proxy`, using `this` ([organizing actions](https://valtio.dev/docs/how-tos/how-to-organize-actions)) | A method                                                         | 0 / 0                                            |
| MobX            | Methods on the object passed to `observable`, which become actions ([observable state](https://mobx.js.org/observable-state.html))    | A method                                                         | 0 / 1                                            |
| Legend-State    | Methods on the object passed to `observable`                                                                                          | A method                                                         | 0 / 0                                            |

Inference works in these libraries because the state's type is known before the
methods are read: TanStack Store, `@xstate/store`, and Redux Toolkit take the
state as a separate argument or field, and Valtio, MobX, and Legend-State type
the object literal before `this` or the variable refers to it. Jotai,
Nanostores, and Preact Signals don't have this shape: their actions are separate
functions or atoms, which are already inferred.

**Valtio's snapshots include the methods.** With methods on the proxy,
`useSnapshot` returns them too. Calling a mutating method on the snapshot, such
as `snap.addDraft(draft)` instead of `state.addDraft(draft)`, type-checks,
doesn't throw, and adds the draft to the snapshot, not the store. Editing an
existing field through the snapshot does throw, because the snapshot's existing
properties are read-only.

### TanStack Store

TanStack Store's `createStore` takes the initial state, then an actions factory
given `setState` and `get`
([quick start](https://tanstack.com/store/latest/docs/framework/react/quick-start)).
Its type is inferred, so no type is declared.

```tsx
import { createStore, useSelector } from '@tanstack/react-store';
import type { Draft } from './types.ts';

export const draftsStore = createStore(
  { drafts: {} as Record<string, Draft> },
  ({ setState, get }) => ({
    addDraft(draft: Draft) {
      setState((s) => ({ drafts: { ...s.drafts, [draft.id]: draft } }));
    },
    editDraft(id: string, body: string) {
      setState((s) => {
        const draft = s.drafts[id];
        return draft
          ? { drafts: { ...s.drafts, [id]: { ...draft, body } } }
          : s;
      });
    },
    discardDraft(id: string) {
      setState((s) => {
        const { [id]: _, ...rest } = s.drafts;
        return { drafts: rest };
      });
    },
    replaceDrafts(drafts: Draft[]) {
      setState(() => ({
        drafts: Object.fromEntries(drafts.map((d) => [d.id, d])),
      }));
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

### TanStack Store with Immer

TanStack Store has no Immer middleware. Immer's `produce` called with only a
recipe returns a function from the old state to the new one
([curried producers](https://immerjs.github.io/immer/curried-produce)), which is
what `setState` takes:

```tsx
import { createStore, useSelector } from '@tanstack/react-store';
import { produce } from 'immer';
import type { Draft } from './types.ts';

export const draftsStore = createStore(
  { drafts: {} as Record<string, Draft> },
  ({ setState, get }) => ({
    addDraft(draft: Draft) {
      setState(
        produce((s) => {
          s.drafts[draft.id] = draft;
        }),
      );
    },
    editDraft(id: string, body: string) {
      setState(
        produce((s) => {
          const draft = s.drafts[id];
          if (draft) draft.body = body;
        }),
      );
    },
    discardDraft(id: string) {
      setState(
        produce((s) => {
          delete s.drafts[id];
        }),
      );
    },
    replaceDrafts(drafts: Draft[]) {
      setState(
        produce((s) => {
          s.drafts = Object.fromEntries(drafts.map((d) => [d.id, d]));
        }),
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

TypeScript infers the recipe's argument from `setState`, so the store's type is
still inferred. `tsc` also caught mistakes inside a recipe, such as assigning a
number to `body` or writing to a misspelled field. Prettier splits each
`setState(produce((s) => { ... }))` over five lines, so this is the longest
example.

### A `createImmerStore` helper for TanStack Store

A first helper, defined inside one store's actions factory, wrapped
`setState(produce(recipe))` and typed the recipe as returning `void`. It needed
one-line recipes written as `update((s) => void (s.drafts[id] = draft))`:
without `void`, the assignment's value is returned, which TypeScript allows for
a `void` function, and Immer threw "An immer producer returned a new value
\*and\* modified its draft". The generic helper below ignores the recipe's
return value instead.

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

The store from the earlier examples, written with it:

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

- **Inferred types.** The store's state and actions are inferred, and mistakes
  inside recipes are caught as with `produce`.
- **Read-only state types.** The store's state is typed with Immer's
  `Immutable`, so `tsc` rejected mutating state read from the store, in a
  component, a selector, or through `get()`
  ([TypeScript](https://immerjs.github.io/immer/typescript)). In 0002, only
  Valtio's types did this. Passing a read-only array from the store to a
  function that takes a mutable array, such as `Draft[]`, is a `tsc` error ("The
  type ... is 'readonly' and cannot be assigned to the mutable type");
  parameters have to be typed `readonly Draft[]`. Single objects with read-only
  fields can be passed to mutable types.
- **One-line recipes.** Because the return value is ignored, assignments and
  `delete` fit on one line without `void`, which is why the store is 32 lines.
- **A cast.** `createStore` rejects function state with a conditional type that
  TypeScript can't check for a generic `T`, so the helper passes the initial
  state `as never`. The comment in the helper explains it.
- **Naming.** Immer calls the object a recipe changes a "draft" and its type
  `Draft`. The helper imports that type as `Writable`, because draft means an
  unsubmitted comment in this project, and the examples' `Draft` type is that
  comment.
- **Not documented by TanStack.** The helper is local code. Agents won't know it
  from training data and would learn it from the repo.

### Immer's maintenance

Immer 11.1.21 was published on 2026-10-02. There were 24 stable releases from
2025-10-14 to 2026-10-14, and 11.0.0 was published on 2025-11-23
(`npm view immer time` on 2026-10-14). Immer has no peer dependencies.

## Options

### A. Zustand with Immer, with an interface

Benefits:

- Zustand's documented TypeScript pattern and its own Immer middleware, so
  agents are likely to know both.
- The interface lists the store's shape in one place, and `tsc` checks the
  implementation against it.
- Mutating read state throws at run time.

Costs:

- Each action's signature is written twice, in the interface and the
  implementation.
- `tsc` doesn't catch mutating read state.
- 4.2 KB, about 3.8 KB of it Immer, and 39 lines.
- Objects passed to actions are frozen.

### B. Zustand with Immer and `combine`

Benefits:

- Each method's signature is written once, where it's implemented.
- Mutating read state throws at run time.

Costs:

- `tsc` errors name a generated `Write<...>` type, and the store's type has to
  be derived with `ReturnType` where it's needed.
- Middleware order matters (`immer(combine(...))`), and `combine` is less common
  in Zustand's docs than the interface pattern.
- `tsc` doesn't catch mutating read state, and objects passed to actions are
  frozen.

### C. TanStack Store with `produce`

Benefits:

- Types are inferred, with no helper or extra middleware.
- Mutating read state throws at run time.

Costs:

- 44 lines, the longest example, because of how Prettier formats
  `setState(produce(...))`.
- 6.6 KB.
- TanStack Store is before 1.0, with API changes in four minor versions in the
  year before 0002, and a 1.0 alpha published
  ([0002](0002-react-state-management.md#maintenance)). `createStore` with an
  actions factory arrived in 0.11.
- `tsc` doesn't catch mutating read state, and objects passed to actions are
  frozen.

### D. TanStack Store with a `createImmerStore` helper

Benefits:

- Types are inferred, and the store is 32 lines with one-line recipes.
- The only example where both `tsc` and the run time catch mutating read state.
- One place to change if TanStack Store's API changes before 1.0.

Costs:

- 6.7 KB, and a 31-line local helper with a cast.
- Read-only arrays from the store need `readonly` parameter types.
- The helper is a local convention that agents learn from the repo, not from
  docs or training data.
- TanStack Store's pre-1.0 status, as in C, and objects passed to actions are
  frozen.

## Gaps

- **Checked by hand:** every example and the other libraries' versions passed
  `tsc`, the probes, and the run described in
  [How the examples were checked](#how-the-examples-were-checked). The examples,
  probes, and harness were in a scratch directory and weren't committed.
- **Development mode only.** The run-time checks ran with
  `NODE_ENV=development`. Immer's docs say it freezes state by default, but
  freezing wasn't checked in a production build.
- **Not checked in a browser** or in the prototype; the examples ran in
  happy-dom.
- **Only drafts were modelled.** The helper wasn't tried on other parts of the
  review UI's state, on several stores, or on large state, and Immer's cost on
  large updates wasn't measured.
- **TanStack Store 1.0.** The helper wasn't tried against the 1.0 alpha.
- **Other middleware.** `combine` wasn't checked with Zustand's other
  middleware, such as `devtools` or `persist`.
- **React Compiler** compatibility wasn't checked, as in 0002.
