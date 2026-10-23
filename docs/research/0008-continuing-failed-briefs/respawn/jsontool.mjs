// Tiny JSON helpers for the shell scripts (no jq on this machine).
//   jsontool.mjs agent <name|short> < agents.json   -> one-line JSON of the agent session, or "null"
//   jsontool.mjs get <path> < file                  -> value at dotted path
//   jsontool.mjs worker <short> < roster.json       -> "pid replPid"
//   jsontool.mjs usage <transcript> <marker>        -> usage of first assistant message after the last user prompt containing marker
//   jsontool.mjs types <transcript>                 -> counts of entry types / subtypes
import { readFileSync } from 'node:fs';

const [cmd, a, b] = process.argv.slice(2);
const stdin = () => readFileSync(0, 'utf8');
const lines = (f) =>
  readFileSync(f, 'utf8')
    .trim()
    .split('\n')
    .flatMap((l) => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });

if (cmd === 'agent') {
  const list = JSON.parse(stdin());
  const hit = list.find((s) => s.name === a || s.id === a);
  console.log(JSON.stringify(hit ?? null));
} else if (cmd === 'get') {
  let v = JSON.parse(stdin());
  for (const k of a.split('.')) v = v?.[k];
  console.log(
    v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : v,
  );
} else if (cmd === 'worker') {
  const w = JSON.parse(stdin()).workers?.[a];
  console.log(w ? `${w.pid ?? ''} ${w.replPid ?? ''}` : '');
} else if (cmd === 'usage') {
  const es = lines(a);
  let idx = -1;
  es.forEach((e, i) => {
    if (
      e.type === 'user' &&
      JSON.stringify(e.message?.content ?? '').includes(b)
    )
      idx = i;
  });
  const next = es
    .slice(idx + 1)
    .find((e) => e.type === 'assistant' && e.message?.usage);
  const u = next?.message?.usage;
  console.log(
    JSON.stringify(
      u
        ? {
            input_tokens: u.input_tokens,
            cache_creation_input_tokens: u.cache_creation_input_tokens,
            cache_read_input_tokens: u.cache_read_input_tokens,
            output_tokens: u.output_tokens,
            model: next.message.model,
          }
        : null,
    ),
  );
} else if (cmd === 'types') {
  const c = {};
  for (const e of lines(a)) {
    const k = [e.type, e.subtype, e.operation].filter(Boolean).join('/');
    c[k] = (c[k] ?? 0) + 1;
  }
  console.log(JSON.stringify(c));
} else {
  console.error('unknown command');
  process.exit(2);
}
