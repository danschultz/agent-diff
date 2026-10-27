import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createImmerStore } from '../src/createImmerStore.ts';

function counterStore() {
  return createImmerStore(
    { counts: {} as Record<string, number>, total: 0 },
    ({ update, get }) => ({
      add(name: string) {
        update((s) => {
          s.counts[name] = (s.counts[name] ?? 0) + 1;
          s.total += 1;
        });
      },
      // A one-line assignment, whose value the recipe returns.
      reset() {
        update((s) => (s.counts = {}));
      },
      setTotal(total: number) {
        update((s) => (s.total = total));
      },
      count(name: string) {
        return get().counts[name] ?? 0;
      },
    }),
  );
}

test('a store starts with its initial state', () => {
  const store = counterStore();
  assert.deepEqual(store.state, { counts: {}, total: 0 });
  assert.equal(store.actions.count('a'), 0);
});

test('actions change state through update, and read it with get', () => {
  const store = counterStore();
  store.actions.add('a');
  store.actions.add('a');
  store.actions.add('b');
  assert.deepEqual(store.state, { counts: { a: 2, b: 1 }, total: 3 });
  assert.equal(store.actions.count('a'), 2);
});

test("a recipe's return value doesn't replace the state", () => {
  const store = counterStore();
  store.actions.add('a');
  store.actions.reset();
  assert.deepEqual(store.state, { counts: {}, total: 1 });
});

test('each update makes new objects only where the state changed', () => {
  const store = counterStore();
  store.actions.add('a');
  const before = store.state;
  store.actions.setTotal(5);
  assert.notEqual(store.state, before);
  assert.equal(store.state.counts, before.counts);
  // An update that changes nothing keeps the same state.
  const after = store.state;
  store.actions.setTotal(5);
  assert.equal(store.state, after);
});

test('state read from a store is frozen', () => {
  const store = counterStore();
  store.actions.add('a');
  assert.throws(() => {
    (store.state as { total: number }).total = 10;
  }, TypeError);
  assert.throws(() => {
    (store.state.counts as Record<string, number>).a = 10;
  }, TypeError);
  assert.equal(store.state.total, 1);
});

test('subscribers see each new state', () => {
  const store = counterStore();
  const seen: number[] = [];
  const subscription = store.subscribe((state) => seen.push(state.total));
  store.actions.add('a');
  store.actions.add('b');
  subscription.unsubscribe();
  store.actions.add('c');
  assert.deepEqual(seen, [1, 2]);
});
