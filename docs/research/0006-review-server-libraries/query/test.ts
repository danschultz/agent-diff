// Exercises a store and prints the result, so each query layer's output can be compared.
import { Store } from './store.ts';

const store = await Store.open(':memory:');
const session = await store.createReviewSession({
  workingDirectories: ['/repo/b', '/repo/a'],
  title: 'Example',
});
await store.addComment(session.id, {
  path: 'src/a.ts',
  startLine: 3,
  endLine: 4,
  body: 'Rename this.',
});
const missing = await store.addComment('nope', {
  path: 'x',
  startLine: 1,
  endLine: 1,
  body: 'x',
});
const fetched = await store.getReviewSession(session.id);
console.log(
  JSON.stringify({ missing, fetched })
    .replace(/[0-9a-f-]{36}/g, '<id>')
    .replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, '<time>'),
);
