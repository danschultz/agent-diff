// Re-anchoring scenarios. Each one is a comment written on an original file
// version, and the current version it has to be placed on.
//
// Format:
// - In `original`, prefix the commented lines with `>>`.
// - In `current`, prefix the lines where the comment should end up with `>>`.
//   For a current or moved comment, that's its new range. For an outdated
//   comment, it's the code that replaced the commented lines. Leave `current`
//   unmarked when the lines were removed with nothing in their place, and set
//   `insertAfter` instead.
// - `current: null` means the file was deleted.
// - `state` can be a list when more than one state is acceptable.
//
// Run `npm run report` to print each scenario with its result, and
// `npm test` to check every expectation.

import type { AnchorState, ReanchorOptions } from '../src/shared/reanchor.ts';

export interface Scenario {
  name: string;
  description: string;
  original: string;
  current: string | null;
  state: AnchorState | AnchorState[];
  insertAfter?: number;
  options?: Partial<ReanchorOptions>;
  /**
   * Set when the expected result records current behavior that's wrong or
   * risky, rather than the behavior we want. The report highlights these.
   */
  knownRisk?: string;
}

export const scenarios: Scenario[] = [
  {
    name: 'unchanged',
    description: 'Nothing changed. The comment stays where it is.',
    original: `
function greet(user) {
>>  const name = user.name;
  return \`Hello, \${name}\`;
}`,
    current: `
function greet(user) {
>>  const name = user.name;
  return \`Hello, \${name}\`;
}`,
    state: 'current',
  },
  {
    name: 'lines-added-above',
    description: 'An import and a helper are added above. The comment shifts down with its lines.',
    original: `
import { db } from './db';

export async function loadUser(id) {
>>  const row = await db.query('select * from users where id = ' + id);
  return row;
}`,
    current: `
import { db } from './db';
import { log } from './log';

function audit(id) {
  log('load', id);
}

export async function loadUser(id) {
>>  const row = await db.query('select * from users where id = ' + id);
  return row;
}`,
    state: 'current',
  },
  {
    name: 'lines-removed-above',
    description: 'A block above is deleted. The comment shifts up.',
    original: `
// TODO: remove once the migration lands
function legacyLoad() {
  return null;
}

function load() {
>>  return fetch('/api/items').then((r) => r.json());
}`,
    current: `
function load() {
>>  return fetch('/api/items').then((r) => r.json());
}`,
    state: 'current',
  },
  {
    name: 'edits-elsewhere',
    description: 'The reviewer drafts while the agent edits a different function. The comment is untouched.',
    original: `
function parse(input) {
>>  return JSON.parse(input);
}

function format(value) {
  return JSON.stringify(value);
}`,
    current: `
function parse(input) {
>>  return JSON.parse(input);
}

function format(value, indent = 2) {
  return JSON.stringify(value, null, indent);
}`,
    state: 'current',
  },
  {
    name: 'repeated-line-shifted',
    description: 'The commented line appears several times in the file. Diff mapping still follows the right copy.',
    original: `
function a(x) {
  if (!x) {
    return null;
  }
}

function b(y) {
  if (!y) {
>>    return null;
  }
}`,
    current: `
function a(x) {
  if (!x) {
    return null;
  }
}

function between() {}

function b(y) {
  if (!y) {
>>    return null;
  }
}`,
    state: 'current',
  },
  {
    name: 'agent-addresses-comment',
    description:
      'The hardest case from 0008: the reviewer asks for a null check and the agent edits exactly that line. The comment must be outdated, shown next to the new line, not "moved" onto it.',
    original: `
function displayName(user) {
>>  return user.profile.name;
}`,
    current: `
function displayName(user) {
>>  return user.profile?.name ?? 'Unknown';
}`,
    state: 'outdated',
  },
  {
    name: 'agent-addresses-small-edit',
    description: 'Like the case above, but the edit is tiny (one character). Still outdated, even at a loose threshold.',
    original: `
export function total(items) {
  let sum = 0;
>>  for (let i = 0; i <= items.length; i++) {
    sum += items[i].price;
  }
  return sum;
}`,
    current: `
export function total(items) {
  let sum = 0;
>>  for (let i = 0; i < items.length; i++) {
    sum += items[i].price;
  }
  return sum;
}`,
    state: 'outdated',
  },
  {
    name: 'range-rewritten',
    description: 'A three-line range is replaced by a different implementation of a different length.',
    original: `
function retry(fn) {
>>  for (let i = 0; i < 3; i++) {
>>    try { return fn(); } catch {}
>>  }
  throw new Error('failed');
}`,
    current: `
function retry(fn) {
>>  return withBackoff(fn, { attempts: 5, baseMs: 100 });
  throw new Error('failed');
}`,
    state: 'outdated',
  },
  {
    name: 'lines-deleted',
    description: 'The commented lines are deleted with nothing in their place.',
    original: `
function save(doc) {
  validate(doc);
>>  console.log('saving', doc);
  return store.put(doc);
}`,
    current: `
function save(doc) {
  validate(doc);
  return store.put(doc);
}`,
    state: 'outdated',
    insertAfter: 2,
  },
  {
    name: 'line-inserted-inside-range',
    description: 'A line is inserted in the middle of the commented range. The commented lines are no longer contiguous, so the range changed.',
    original: `
async function handler(req) {
>>  const body = await req.json();
>>  const result = await process(body);
  return Response.json(result);
}`,
    current: `
async function handler(req) {
>>  const body = await req.json();
>>  validate(body);
>>  const result = await process(body);
  return Response.json(result);
}`,
    state: 'outdated',
  },
  {
    name: 'function-moved',
    description: 'The commented function is moved to the bottom of the file unchanged. Content matching follows it.',
    original: `
export function main() {
  run();
}

>>function computeChecksum(buffer) {
>>  let hash = 0;
>>  for (const byte of buffer) hash = (hash * 31 + byte) >>> 0;
>>  return hash;
>>}

function run() {
  console.log('running');
}`,
    current: `
export function main() {
  run();
}

function run() {
  console.log('running');
}

>>function computeChecksum(buffer) {
>>  let hash = 0;
>>  for (const byte of buffer) hash = (hash * 31 + byte) >>> 0;
>>  return hash;
>>}`,
    state: ['current', 'moved'],
  },
  {
    name: 'moved-and-reindented',
    description: 'The commented lines are wrapped in a new block, so their indentation changes. Whitespace is normalized, so they are found.',
    original: `
function sync(items) {
>>  const batch = items.filter((item) => item.dirty);
>>  await api.save(batch);
}`,
    current: `
function sync(items) {
  if (items.length > 0) {
>>    const batch = items.filter((item) => item.dirty);
>>    await api.save(batch);
  }
}`,
    state: 'moved',
  },
  {
    name: 'moved-with-rename',
    description:
      'A function is moved and one identifier is renamed. Found at the default threshold (0.9), outdated at 1.0. Compare thresholds in the report.',
    original: `
>>function formatCurrency(amountInCents, currencyCode) {
>>  const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: currencyCode });
>>  return formatter.format(amountInCents / 100);
>>}

export function renderInvoice(invoice) {
  return invoice.lines.map((line) => formatCurrency(line.cents, invoice.currency));
}`,
    current: `
export function renderInvoice(invoice) {
  return invoice.lines.map((line) => formatCurrency(line.cents, invoice.currency));
}

>>function formatCurrency(amountInCents, currency) {
>>  const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: currency });
>>  return formatter.format(amountInCents / 100);
>>}`,
    state: 'moved',
  },
  {
    name: 'duplicated-block',
    description:
      'The commented block is edited in place, and an exact copy of the original also exists twice elsewhere. Picking one would be a guess, so it is outdated.',
    original: `
function a() {
>>  const config = loadConfig();
>>  validateConfig(config);
}

function b() {
  return 1;
}`,
    current: `
function a() {
>>  const config = loadConfig({ strict: true });
}

function b() {
  return 1;
}

function c() {
  const config = loadConfig();
  validateConfig(config);
}

function d() {
  const config = loadConfig();
  validateConfig(config);
}`,
    state: 'outdated',
  },
  {
    name: 'single-copy-elsewhere',
    description:
      'The commented block is edited in place, and one identical copy of the original exists in another function.',
    knownRisk:
      'The comment lands on the copy in c(), which is the wrong code. Diff mapping aligns the original lines with the copy, so this is reported with full confidence as current, not as a guessed move.',
    original: `
function a() {
>>  const config = loadConfig();
>>  validateConfig(config);
}`,
    current: `
function a() {
  const config = loadConfig({ strict: true });
}

function c() {
>>  const config = loadConfig();
>>  validateConfig(config);
}`,
    state: ['current', 'moved'],
  },
  {
    name: 'short-line-without-context',
    description: 'A comment on a lone closing brace whose surroundings were rewritten. Too little content to match safely, so it is outdated.',
    original: `
function a() {
  return 1;
>>}

function b() {
  return 2;
}`,
    current: `
>>const a = () => 1;
>>const b = () => 2;

function c() {
  return 3;
}`,
    state: 'outdated',
  },
  {
    name: 'whitespace-only-change',
    description: 'A formatter changes only whitespace on the commented line. The lines changed, but an exact normalized match is found in place.',
    original: `
function add(a, b) {
>>  return a+b;
}`,
    current: `
function add(a, b) {
>>  return  a+b;
}`,
    state: 'moved',
  },
  {
    name: 'top-of-file-header-added',
    description: 'A license header is added at the top. A comment on line 1 shifts down.',
    original: `
>>import express from 'express';
const app = express();`,
    current: `
// Copyright 2026 Example Corp.
// SPDX-License-Identifier: MIT

>>import express from 'express';
const app = express();`,
    state: 'current',
  },
  {
    name: 'end-of-file-append',
    description: 'Lines are appended after the commented last line.',
    original: `
const app = express();
>>app.listen(3000);`,
    current: `
const app = express();
>>app.listen(3000);

process.on('SIGTERM', () => app.close());`,
    state: 'current',
  },
  {
    name: 'file-rewritten',
    description: 'The whole file is rewritten. Nothing matches.',
    original: `
class Cache {
>>  get(key) {
>>    return this.map.get(key);
>>  }
}`,
    current: `
>>export const cache = new LRUCache({ max: 500 });
>>export const get = (key) => cache.get(key);`,
    state: 'outdated',
  },
  {
    name: 'file-deleted',
    description: 'The file is deleted.',
    original: `
>>export const VERSION = '1.0.0';`,
    current: null,
    state: 'outdated',
  },
  {
    name: 'blocks-swapped',
    description: 'Two functions swap places. Either current or moved is acceptable, as long as the comment lands on the same lines.',
    original: `
function first() {
  return 'first function body';
}

function second() {
>>  return 'second function body, which is commented';
}`,
    current: `
function second() {
>>  return 'second function body, which is commented';
}

function first() {
  return 'first function body';
}`,
    state: ['current', 'moved'],
  },
];

export interface ParsedMarked {
  text: string;
  range: { start: number; end: number } | null;
}

/** Strips `>>` markers and returns the text plus the marked line range. */
export function parseMarked(source: string): ParsedMarked {
  const body = source.replace(/^\n/, '');
  const lines = body.split('\n');
  const out: string[] = [];
  let start = -1;
  let end = -1;
  lines.forEach((line, i) => {
    if (line.startsWith('>>')) {
      if (start === -1) start = i + 1;
      else if (end !== i) throw new Error(`Marked lines must be contiguous (line ${i + 1})`);
      end = i + 1;
      out.push(line.slice(2));
    } else {
      out.push(line);
    }
  });
  return { text: out.join('\n') + '\n', range: start === -1 ? null : { start, end } };
}
