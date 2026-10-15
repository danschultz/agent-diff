// Times 2,000 reads of a review session with 20 comments.
import { Store } from './store.ts';
const store = await Store.open(':memory:');
const { id } = await store.createReviewSession({
  workingDirectories: ['/repo/a', '/repo/b'],
});
for (let i = 0; i < 20; i++)
  await store.addComment(id, {
    path: 'src/a.ts',
    startLine: i + 1,
    endLine: i + 2,
    body: `Comment ${i}`,
  });
const times: number[] = [];
for (let round = 0; round < 5; round++) {
  const start = performance.now();
  for (let i = 0; i < 2000; i++) await store.getReviewSession(id);
  times.push(performance.now() - start);
}
times.sort((a, b) => a - b);
console.log(
  `${process.cwd().split('/').pop()}\t${times[2]!.toFixed(0)} ms for 2,000 reads`,
);
