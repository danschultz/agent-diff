// Summarises a transcript for the stop-hook experiments: one line per user or
// assistant entry with its kind and, for assistant messages, usage. It prints
// no message text, only a classification, and marks the entries after each Stop
// hook block. Usage: node usage.mjs <transcript.jsonl>
import { existsSync, readFileSync } from 'node:fs';

const file = process.argv[2];
if (!existsSync(file)) {
  console.log('  (no transcript)');
  process.exit(0);
}
const entries = readFileSync(file, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return {};
    }
  });

const textOf = (c) =>
  typeof c === 'string'
    ? c
    : Array.isArray(c)
      ? c.map((x) => x.text ?? JSON.stringify(x.content ?? '')).join(' ')
      : '';
const partsOf = (c) =>
  Array.isArray(c)
    ? c.map((x) => x.type + (x.name ? `(${x.name})` : '')).join(',')
    : typeof c === 'string'
      ? 'text'
      : '';

let blocks = 0;
const seen = new Set();
const total = { in: 0, create: 0, read: 0, out: 0, n: 0 };
const after = { in: 0, create: 0, read: 0, out: 0, n: 0 };
const add = (t, u) => {
  t.in += u.input_tokens ?? 0;
  t.create += u.cache_creation_input_tokens ?? 0;
  t.read += u.cache_read_input_tokens ?? 0;
  t.out += u.output_tokens ?? 0;
  t.n++;
};
for (const e of entries) {
  const c = e.message?.content;
  const time = e.timestamp?.slice(11, 19) ?? '        ';
  if (e.type === 'user') {
    const text = textOf(c);
    let kind = e.isMeta
      ? 'meta'
      : partsOf(c).includes('tool_result')
        ? 'tool_result'
        : 'prompt';
    if (/No pull request yet/.test(text)) {
      blocks++;
      kind = `STOP-HOOK BLOCK ${blocks} (${e.isMeta ? 'meta ' : ''}user entry)`;
    } else if (/task-notification/.test(text)) kind = 'task-notification';
    console.log(`  ${time} user      ${kind}`);
  } else if (e.type === 'assistant') {
    const u = e.message?.usage ?? {};
    const again = seen.has(e.message?.id);
    console.log(
      `  ${time} assistant ${partsOf(c).padEnd(16)} ${again ? '(same API response as above)' : `in=${u.input_tokens} cache_create=${u.cache_creation_input_tokens} cache_read=${u.cache_read_input_tokens} out=${u.output_tokens}`}${blocks ? `  [after block ${blocks}]` : ''}`,
    );
    if (e.message?.usage && !seen.has(e.message.id)) {
      seen.add(e.message.id);
      add(total, u);
      if (blocks) add(after, u);
    }
  } else if (e.type === 'system' || e.type === 'attachment') {
    const sub = e.subtype ?? e.attachment?.type ?? '';
    console.log(`  ${time} ${e.type}/${sub}`);
  }
}
const fmt = (t) =>
  `in=${t.in} cache_create=${t.create} cache_read=${t.read} out=${t.out} (${t.n} API responses)`;
console.log(`  total: ${fmt(total)}`);
console.log(`  after the first block: ${fmt(after)}; blocks seen: ${blocks}`);
