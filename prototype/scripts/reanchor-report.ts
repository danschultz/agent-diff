// Prints every re-anchoring scenario with its result, so placements can be
// checked by eye, and compares results across similarity thresholds.
//
//   npm run report
//   npm run report -- --only agent-addresses-comment
//   npm run report -- --thresholds 1,0.95,0.9,0.8 --context 2
//   npm run report -- --summary

import { parseArgs } from 'node:util';
import {
  reanchor,
  splitLines,
  type ReanchorResult,
} from '../src/shared/reanchor.ts';
import {
  parseMarked,
  scenarios,
  type Scenario,
} from '../test/reanchor-scenarios.ts';

const { values } = parseArgs({
  options: {
    only: { type: 'string' },
    thresholds: { type: 'string', default: '1,0.9,0.8,0.7' },
    context: { type: 'string' },
    summary: { type: 'boolean', default: false },
  },
});

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: number) => (s: string) =>
  color ? `\x1b[${code}m${s}\x1b[0m` : s;
const bold = paint(1);
const dim = paint(2);
const red = paint(31);
const green = paint(32);
const yellow = paint(33);
const cyan = paint(36);

const thresholds = values.thresholds.split(',').map(Number);
const contextLines =
  values.context === undefined ? undefined : Number(values.context);
const selected = scenarios.filter(
  (s) => !values.only || s.name === values.only,
);
if (selected.length === 0) {
  console.error(
    `No scenario named "${values.only}". Names: ${scenarios.map((s) => s.name).join(', ')}`,
  );
  process.exit(1);
}

let failures = 0;
const rows: string[][] = [];

for (const scenario of selected) {
  const original = parseMarked(scenario.original);
  const current =
    scenario.current === null ? null : parseMarked(scenario.current);
  const base = {
    ...scenario.options,
    ...(contextLines === undefined ? {} : { contextLines }),
  };
  const result = reanchor(
    original.text,
    original.range!,
    current?.text ?? null,
    base,
  );
  const ok = matches(scenario, result, current?.range ?? null);
  if (!ok) failures++;

  const sweep = thresholds.map(
    (t) =>
      reanchor(original.text, original.range!, current?.text ?? null, {
        ...base,
        minSimilarity: t,
      }).state,
  );
  rows.push([
    scenario.name,
    result.state,
    ok ? 'yes' : 'NO',
    scenario.knownRisk ? 'risk' : '',
    ...sweep,
  ]);

  if (values.summary) continue;

  console.log(
    bold(
      `\n━━ ${scenario.name} ${'━'.repeat(Math.max(0, 70 - scenario.name.length))}`,
    ),
  );
  console.log(scenario.description);
  if (scenario.knownRisk)
    console.log(yellow(`Known risk: ${scenario.knownRisk}`));

  console.log(dim('\nOriginal (▶ = commented lines)'));
  printLines(splitLines(original.text), (n) =>
    n >= original.range!.start && n <= original.range!.end ? cyan('▶') : ' ',
  );

  if (current === null) {
    console.log(dim('\nCurrent: file deleted'));
  } else {
    console.log(
      dim(
        '\nCurrent (▶ = placed comment, ~ = replacement code, ^ = removed lines were here, ✗ = expected but not chosen)',
      ),
    );
    printLines(
      splitLines(current.text),
      (n) => {
        const placed =
          result.range && n >= result.range.start && n <= result.range.end;
        const replaced =
          result.replacement &&
          n >= result.replacement.start &&
          n <= result.replacement.end;
        const expected =
          current.range && n >= current.range.start && n <= current.range.end;
        if (placed) return expected ? green('▶') : red('▶');
        if (replaced) return expected ? yellow('~') : red('~');
        if (expected) return red('✗');
        return ' ';
      },
      result.insertAfter,
    );
  }

  const expectedStates = Array.isArray(scenario.state)
    ? scenario.state.join(' or ')
    : scenario.state;
  console.log(`\nResult:   ${stateLabel(result.state)}. ${result.reason}`);
  console.log(
    `Expected: ${expectedStates} ${ok ? green('✓ matches') : red('✗ does not match')}`,
  );
  console.log(
    `Sweep:    ${thresholds.map((t, i) => `${t.toFixed(2)} → ${stateLabel(sweep[i])}`).join('   ')}`,
  );
}

console.log(bold('\nSummary'));
const header = [
  'scenario',
  'state',
  'expected?',
  'note',
  ...thresholds.map((t) => `@${t}`),
];
const widths = header.map((h, i) =>
  Math.max(h.length, ...rows.map((r) => r[i].length)),
);
const line = (cells: string[]) =>
  cells.map((c, i) => c.padEnd(widths[i])).join('  ');
console.log(dim(line(header)));
for (const row of rows) console.log(line(row));
console.log(
  failures === 0
    ? green(`\nAll ${rows.length} scenarios match their expectations.`)
    : red(`\n${failures} scenario(s) don't match.`),
);
process.exitCode = failures === 0 ? 0 : 1;

function matches(
  scenario: Scenario,
  result: ReanchorResult,
  expected: { start: number; end: number } | null,
): boolean {
  const allowed = Array.isArray(scenario.state)
    ? scenario.state
    : [scenario.state];
  if (!allowed.includes(result.state)) return false;
  const actual =
    result.state === 'outdated' ? result.replacement : result.range;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) return false;
  if (
    scenario.insertAfter !== undefined &&
    result.insertAfter !== scenario.insertAfter
  )
    return false;
  return true;
}

function printLines(
  lines: string[],
  marker: (n: number) => string,
  insertAfter: number | null = null,
) {
  const width = String(lines.length).length;
  if (insertAfter === 0)
    console.log(
      `  ${yellow('^')} ${''.padStart(width)}   ${dim('(removed lines were here)')}`,
    );
  lines.forEach((text, i) => {
    const n = i + 1;
    console.log(`  ${marker(n)} ${dim(String(n).padStart(width))} │ ${text}`);
    if (insertAfter === n)
      console.log(
        `  ${yellow('^')} ${''.padStart(width)}   ${dim('(removed lines were here)')}`,
      );
  });
}

function stateLabel(state: string): string {
  if (state === 'current') return green(state);
  if (state === 'moved') return yellow(state);
  return red(state);
}
