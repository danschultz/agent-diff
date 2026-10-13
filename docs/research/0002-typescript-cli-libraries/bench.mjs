// Times `node cli.ts start --help` for each example named on the command line.
// 5 warmup runs each, then N measured runs (default 40), interleaved across
// examples, with stdout and stderr sent to /dev/null.
// Usage: node bench.mjs parseargs commander ...
import { spawnSync } from 'node:child_process';

const N = Number(process.env.N ?? 40);
const examples = process.argv.slice(2);
const results = {};

const time = (example) => {
  const start = process.hrtime.bigint();
  const r = spawnSync(process.execPath, ['cli.ts', 'start', '--help'], {
    cwd: new URL(`./${example}/`, import.meta.url),
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  if (r.status !== 0) throw new Error(`${example} exited ${r.status}`);
  return Number(process.hrtime.bigint() - start) / 1e6;
};

for (const example of examples) {
  for (let i = 0; i < 5; i++) time(example);
  results[example] = [];
}
for (let i = 0; i < N; i++) for (const example of examples) results[example].push(time(example));

for (const example of examples) {
  const xs = results[example].sort((a, b) => a - b);
  const median = xs[Math.floor(xs.length / 2)];
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  console.log(`${example}\tmedian=${median.toFixed(0)}\tmean=${mean.toFixed(0)}\tmin=${xs[0].toFixed(0)}\tmax=${xs.at(-1).toFixed(0)}`);
}
