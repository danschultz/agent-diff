// Requests per second for "get review session" on each example, 10 connections for 5 s.
import autocannon from 'autocannon';
import { spawn } from 'node:child_process';
const node = process.env.NODE ?? 'node';
const [dir, ...names] = process.argv.slice(2);
const headers = {
  authorization: 'Bearer dev-token',
  'content-type': 'application/json',
};
const base = 'http://127.0.0.1:4430/api';
for (const name of names) {
  const child = spawn(node, ['server.ts'], {
    cwd: `${dir}/${name}`,
    env: { ...process.env, PORT: '4430' },
    stdio: 'ignore',
  });
  for (;;) {
    try {
      await fetch(`${base}/health`, { headers });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  const trpc = name === 'trpc';
  const res = await fetch(
    trpc ? `${base}/reviewSessions.create` : `${base}/review-sessions`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ workingDirectories: ['/repo/a', '/repo/b'] }),
    },
  );
  const json = await res.json();
  const id = trpc ? json.result.data.id : json.id;
  const url = trpc
    ? `${base}/reviewSessions.get?input=${encodeURIComponent(JSON.stringify({ id }))}`
    : `${base}/review-sessions/${id}`;
  const result = await autocannon({
    url,
    headers,
    connections: 10,
    duration: 5,
  });
  console.log(
    `${name}\t${Math.round(result.requests.average)} req/s\tp50 ${result.latency.p50} ms\tnon-2xx ${result.non2xx}`,
  );
  child.kill();
  await new Promise((r) => child.on('exit', r));
}
