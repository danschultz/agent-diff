// Creates every store in the review UI, as decision 0016 says: TanStack Store
// state, changed through Immer, with read-only state types. Actions change
// state by assigning to or deleting from the draft `update` gives them, and
// values computed from state are actions that read it with `get`.
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
