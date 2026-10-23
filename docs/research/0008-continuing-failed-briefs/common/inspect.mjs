// Summarises a Claude Code transcript for the 0008 prototypes. It prints only
// entry types, counts, and short facts, never message text beyond the
// synthetic assistant message, and never IDs from bridge entries.
//
// Usage: node inspect.mjs <transcript.jsonl> [marker]
//   marker: text of the prompt that continued the agent session. The summary
//   covers the entries after the last user entry containing it.
import { readFileSync, existsSync } from 'node:fs';

const [file, marker = 'exited before you finished'] = process.argv.slice(2);
if (!file || !existsSync(file)) {
  console.log(`transcript: missing (${file})`);
  process.exit(0);
}
const entries = readFileSync(file, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return { type: '(unparseable)' };
    }
  });

const text = (e) => {
  const c = e.message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((p) => p.text ?? '').join('\n');
  return '';
};
let cut = -1;
entries.forEach((e, i) => {
  if (e.type === 'user' && text(e).includes(marker)) cut = i;
});

const count = (list) => {
  const c = {};
  for (const e of list) {
    const key = e.subtype ? `${e.type}/${e.subtype}` : e.type;
    c[key] = (c[key] ?? 0) + 1;
  }
  return JSON.stringify(c);
};
console.log(`entries: ${entries.length}, continue prompt at entry ${cut}`);
console.log(`types before: ${count(entries.slice(0, cut + 1))}`);
console.log(`types after:  ${count(entries.slice(cut + 1))}`);

const modes = entries
  .map((e, i) => ({ e, i }))
  .filter(({ e }) => e.type === 'permission-mode')
  .map(({ e, i }) => `${i}${i > cut ? '(after)' : ''}:${e.permissionMode}`);
console.log(`permission-mode entries: ${modes.join(' ') || 'none'}`);

const bridge = entries
  .map((e, i) => ({ e, i }))
  .filter(
    ({ e }) => /bridge/i.test(e.type ?? '') || /bridge/i.test(e.subtype ?? ''),
  )
  .map(
    ({ e, i }) =>
      `${i}${i > cut ? '(after)' : ''}:${e.type}${e.subtype ? '/' + e.subtype : ''}`,
  );
console.log(`bridge entries: ${bridge.join(' ') || 'none'}`);

const sessionIds = new Set(entries.map((e) => e.sessionId).filter(Boolean));
console.log(`sessionId values in entries: ${sessionIds.size}`);

const synthetic = entries
  .map((e, i) => ({ e, i }))
  .filter(
    ({ e }) => e.type === 'assistant' && e.message?.model === '<synthetic>',
  );
for (const { e, i } of synthetic)
  console.log(
    `synthetic assistant at ${i}${i > cut ? '(after)' : ''}: ${JSON.stringify(text(e)).slice(0, 120)}`,
  );

const models = new Set(
  entries
    .filter(
      (e, i) =>
        e.type === 'assistant' && i > cut && e.message?.model !== '<synthetic>',
    )
    .map((e) => e.message?.model),
);
const modelsBefore = new Set(
  entries
    .filter(
      (e, i) =>
        e.type === 'assistant' &&
        i <= cut &&
        e.message?.model !== '<synthetic>',
    )
    .map((e) => e.message?.model),
);
console.log(
  `models before: ${[...modelsBefore].join(',') || '-'}; after: ${[...models].join(',') || '-'}`,
);

const first = entries.find(
  (e, i) =>
    i > cut && e.type === 'assistant' && e.message?.model !== '<synthetic>',
);
if (first) {
  const u = first.message.usage ?? {};
  console.log(
    `first assistant usage after continuing: input=${u.input_tokens} cache_creation=${u.cache_creation_input_tokens} cache_read=${u.cache_read_input_tokens} output=${u.output_tokens}`,
  );
} else console.log('first assistant usage after continuing: none');

const last = [...entries]
  .reverse()
  .find((e) => e.type === 'assistant' && e.message?.model !== '<synthetic>');
if (last)
  console.log(
    `last assistant text: ${JSON.stringify(text(last)).slice(0, 300)}`,
  );
