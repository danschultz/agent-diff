// The background process the agent starts, plus the commands that talk to it.
//
//   node client.mjs listen [--session S] [--once]
//       Connects to the review server and prints one line per message.
//       With --once it prints the first message and exits, for agents that
//       only learn about a background command when it exits. Without it, it
//       keeps printing, for watchers that turn each line into an event, and
//       serves a Unix socket that `reply` writes to.
//   node client.mjs reply [--session S] [--direct] <message-id> <text...>
//       Sends a reply through the listener's Unix socket when one is running
//       for the session, otherwise (or with --direct) straight to the server.
//   node client.mjs send <session> <text...>
//       Stands in for the review server's UI: queues a message for a session.
//
// The session defaults to $BGPROC_SESSION, then $CLAUDE_CODE_SESSION_ID.

import { createServer, createConnection } from 'node:net';
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const base = process.env.BGPROC_URL ?? 'http://127.0.0.1:47105';
const token = process.env.BGPROC_TOKEN ?? '';
const sockDir = process.env.BGPROC_SOCK_DIR ?? '/tmp/agent-diff-bgproc';
const self = fileURLToPath(import.meta.url);
const headers = token ? { authorization: `Bearer ${token}` } : {};

const args = process.argv.slice(2);
const cmd = args.shift();
const flag = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
};
const option = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};

const session =
  option('--session') ??
  process.env.BGPROC_SESSION ??
  process.env.CLAUDE_CODE_SESSION_ID ??
  '';
const sockPath = (s) => join(sockDir, `${s}.sock`);

function line(m) {
  return (
    `[agent-diff review message ${m.id}] ${JSON.stringify(m.text)} ` +
    `-- answer it with: node ${self} reply --session ${m.session} ${m.id} "<your answer>"`
  );
}

async function postReply(id, text) {
  const res = await fetch(`${base}/replies`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ id, text, session }),
  });
  return `${res.status} ${(await res.text()).trim()}`;
}

async function listenOnce() {
  for (;;) {
    let res;
    try {
      res = await fetch(`${base}/next?session=${encodeURIComponent(session)}`, {
        headers,
      });
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    if (res.status === 204) continue; // Long poll timed out; ask again.
    if (res.status !== 200) {
      console.log(`[agent-diff] review server answered ${res.status}`);
      process.exit(1);
    }
    console.log(line(await res.json()));
    process.exit(0);
  }
}

// Replies written to the socket are forwarded to the review server, so the
// agent's reply goes through the same process that delivered the message.
function serveReplies() {
  mkdirSync(sockDir, { recursive: true });
  const p = sockPath(session);
  if (existsSync(p)) unlinkSync(p);
  const srv = createServer((c) => {
    let buf = '';
    c.on('data', async (d) => {
      buf += d;
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      const { id, text } = JSON.parse(buf.slice(0, nl));
      try {
        c.end((await postReply(id, text)) + '\n');
      } catch (e) {
        c.end(`error ${e.message}\n`);
      }
    });
  });
  srv.listen(p);
  const cleanup = () => {
    try {
      unlinkSync(p);
    } catch {}
    process.exit(0);
  };
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGHUP', cleanup);
}

async function listenStream() {
  serveReplies();
  let wasConnected = false;
  let saidDown = false;
  for (;;) {
    try {
      const res = await fetch(
        `${base}/stream?session=${encodeURIComponent(session)}`,
        {
          headers,
        },
      );
      if (res.status !== 200) throw new Error(`status ${res.status}`);
      if (saidDown)
        console.log('[agent-diff] reconnected to the review server');
      saidDown = false;
      wasConnected = true;
      let buf = '';
      for await (const chunk of res.body) {
        buf += Buffer.from(chunk).toString();
        let nl;
        while ((nl = buf.indexOf('\n')) !== -1) {
          const obj = JSON.parse(buf.slice(0, nl));
          buf = buf.slice(nl + 1);
          if (obj.id) console.log(line(obj));
        }
      }
      throw new Error('stream ended');
    } catch (e) {
      if (wasConnected && !saidDown) {
        console.log(
          `[agent-diff] lost the review server (${e.message}); retrying`,
        );
        saidDown = true;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function reply() {
  const direct = flag('--direct');
  const [id, ...rest] = args;
  const text = rest.join(' ');
  if (!id || !text) {
    console.error(
      'usage: client.mjs reply [--session S] [--direct] <message-id> <text>',
    );
    process.exit(2);
  }
  if (!direct && session && existsSync(sockPath(session))) {
    const c = createConnection(sockPath(session));
    c.on('error', async () =>
      console.log(`direct: ${await postReply(id, text)}`),
    );
    c.on('data', (d) => process.stdout.write(`via listener: ${d}`));
    c.write(JSON.stringify({ id, text }) + '\n');
    return;
  }
  console.log(`direct: ${await postReply(id, text)}`);
}

async function send() {
  const [to, ...rest] = args;
  const res = await fetch(`${base}/messages`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ session: to, text: rest.join(' ') }),
  });
  process.stdout.write(await res.text());
}

if (cmd === 'listen') {
  if (!session) {
    console.log(
      '[agent-diff] no session: pass --session or set BGPROC_SESSION',
    );
    process.exit(2);
  }
  await (flag('--once') ? listenOnce() : listenStream());
} else if (cmd === 'reply') await reply();
else if (cmd === 'send') await send();
else {
  console.error('usage: client.mjs listen|reply|send ...');
  process.exit(2);
}
