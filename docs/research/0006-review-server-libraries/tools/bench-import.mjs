// Median wall-clock time of `node <file>` in each directory, interleaved.
// Usage: node bench-import.mjs <runs> <file> <dir...>
import { spawnSync } from 'node:child_process';
const [runsArg, file, ...dirs] = process.argv.slice(2);
const node = process.env.NODE ?? 'node';
const times = Object.fromEntries(dirs.map((d) => [d, []]));
const once = (d) => {
  const start = performance.now();
  const r = spawnSync(node, [file], { cwd: d, stdio: 'ignore' });
  if (r.status !== 0) throw new Error(`${d}: exit ${r.status}`);
  return performance.now() - start;
};
for (let i = 0; i < 3; i++) for (const d of dirs) once(d);
for (let i = 0; i < Number(runsArg); i++)
  for (const d of dirs) times[d].push(once(d));
for (const d of dirs) {
  const xs = times[d].sort((a, b) => a - b);
  console.log(
    `${d.split('/').pop()}\t${xs[Math.floor(xs.length / 2)].toFixed(0)} ms`,
  );
}
