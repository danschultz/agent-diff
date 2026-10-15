// Measures the time from spawning each example's server to its first 200
// response on /api/health. Runs are interleaved across examples.
// Usage: node bench-startup.mjs <server dir> <runs> <name...>
import { spawn } from 'node:child_process';
import { request } from 'node:http';

const [dir, runsArg, ...names] = process.argv.slice(2);
const node = process.env.NODE ?? 'node';
const runs = Number(runsArg);
const env = { ...process.env, PORT: '4420', AGENT_DIFF_TOKEN: 'dev-token' };

const ok = () =>
  new Promise((resolve) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: 4420,
        path: '/api/health',
        headers: { authorization: 'Bearer dev-token' },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on('error', () => resolve(false));
    req.end();
  });

async function once(name) {
  const start = performance.now();
  const child = spawn(node, ['server.ts'], {
    cwd: `${dir}/${name}`,
    env,
    stdio: 'ignore',
  });
  while (!(await ok())) await new Promise((r) => setTimeout(r, 2));
  const ms = performance.now() - start;
  const exited = new Promise((r) => child.on('exit', r));
  child.kill();
  await exited;
  return ms;
}

const times = Object.fromEntries(names.map((n) => [n, []]));
for (let i = 0; i < 3; i++) for (const n of names) await once(n);
for (let i = 0; i < runs; i++)
  for (const n of names) times[n].push(await once(n));
const median = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
for (const n of names) console.log(`${n}\t${median(times[n]).toFixed(0)} ms`);
