// Replays real edits from git history through re-anchoring. Places synthetic
// comments across every file changed between two refs, re-anchors them onto
// the later version, and reports how many end up current, moved, or outdated,
// with samples of moved and outdated comments to check by eye.
//
//   npm run replay -- --repo ~/code/some-repo --from main --to agent/branch
//   npm run replay -- --repo . --from HEAD~5 --to HEAD --window 1 --step 3 --threshold 1
//   npm run replay -- --repo . --from main --to WORKTREE

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { reanchor, splitLines, type AnchorState } from '../src/shared/reanchor.ts';

const { values } = parseArgs({
  options: {
    repo: { type: 'string', default: '.' },
    from: { type: 'string' },
    to: { type: 'string', default: 'HEAD' },
    window: { type: 'string', default: '3' },
    step: { type: 'string', default: '7' },
    threshold: { type: 'string' },
    samples: { type: 'string', default: '4' },
    'max-files': { type: 'string', default: '200' },
  },
});

if (!values.from) {
  console.error('Usage: npm run replay -- --repo <path> --from <ref> [--to <ref>|WORKTREE] [--window 3] [--step 7] [--threshold 0.9]');
  process.exit(1);
}

const repo = path.resolve(values.repo);
const windowSize = Number(values.window);
const step = Number(values.step);
const sampleCount = Number(values.samples);
const options = values.threshold === undefined ? {} : { minSimilarity: Number(values.threshold) };
const toWorktree = values.to === 'WORKTREE';

const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const show = (ref: string, file: string): string | null => {
  try {
    if (ref === 'WORKTREE') return readFileSync(path.join(repo, file), 'utf8');
    return git('show', `${ref}:${file}`);
  } catch {
    return null;
  }
};

const diffArgs = toWorktree ? ['diff', '--name-status', '-M', '-z', values.from] : ['diff', '--name-status', '-M', '-z', values.from, values.to];
const fields = git(...diffArgs).split('\0').filter(Boolean);
const files: { from: string; to: string | null }[] = [];
for (let i = 0; i < fields.length; ) {
  const status = fields[i++];
  if (status.startsWith('R') || status.startsWith('C')) {
    files.push({ from: fields[i++], to: fields[i++] });
  } else if (status === 'D') {
    files.push({ from: fields[i++], to: null });
  } else if (status === 'A') {
    i++;
  } else {
    const file = fields[i++];
    files.push({ from: file, to: file });
  }
}

const totals: Record<AnchorState, number> = { current: 0, moved: 0, outdated: 0 };
let fuzzyMoves = 0;
const samples: Record<'moved' | 'outdated', string[]> = { moved: [], outdated: [] };
const perFile: { file: string; counts: Record<AnchorState, number> }[] = [];

for (const file of files.slice(0, Number(values['max-files']))) {
  const before = show(values.from, file.from);
  if (before === null || before.includes('\0')) continue;
  const after = file.to === null ? null : show(values.to, file.to);
  if (after !== null && after.includes('\0')) continue;
  const lines = splitLines(before);
  const counts: Record<AnchorState, number> = { current: 0, moved: 0, outdated: 0 };

  for (let start = 1; start + windowSize - 1 <= lines.length; start += step) {
    const end = start + windowSize - 1;
    if (lines.slice(start - 1, end).every((l) => l.trim() === '')) continue;
    const result = reanchor(before, { start, end }, after, options);
    counts[result.state]++;
    totals[result.state]++;
    if (result.state === 'moved' && result.similarity !== null && result.similarity < 1) fuzzyMoves++;

    if (result.state !== 'current' && samples[result.state].length < sampleCount * 4) {
      const afterLines = after === null ? [] : splitLines(after);
      const placed = result.range ?? result.replacement;
      samples[result.state].push(
        [
          `${file.from}:${start}-${end} → ${file.to ?? '(deleted)'}${placed ? `:${placed.start}-${placed.end}` : ''}  ${result.reason}`,
          ...lines.slice(start - 1, end).map((l) => `    - ${l}`),
          ...(placed ? afterLines.slice(placed.start - 1, placed.end).map((l) => `    + ${l}`) : []),
        ].join('\n'),
      );
    }
  }
  perFile.push({ file: file.from, counts });
}

const total = totals.current + totals.moved + totals.outdated;
const pct = (n: number) => (total === 0 ? '0%' : `${((100 * n) / total).toFixed(1)}%`);
console.log(`Replayed ${total} synthetic comments (window ${windowSize}, every ${step} lines) across ${perFile.length} changed files`);
console.log(`${values.from} → ${values.to} in ${repo}\n`);
console.log(`  current   ${String(totals.current).padStart(6)}  ${pct(totals.current)}`);
console.log(`  moved     ${String(totals.moved).padStart(6)}  ${pct(totals.moved)}  (${fuzzyMoves} fuzzy, ${totals.moved - fuzzyMoves} exact)`);
console.log(`  outdated  ${String(totals.outdated).padStart(6)}  ${pct(totals.outdated)}`);

console.log('\nFiles with the most outdated comments:');
for (const f of perFile.sort((a, b) => b.counts.outdated - a.counts.outdated).slice(0, 10)) {
  console.log(`  ${String(f.counts.outdated).padStart(4)} outdated, ${String(f.counts.moved).padStart(3)} moved, ${String(f.counts.current).padStart(4)} current  ${f.file}`);
}

for (const state of ['moved', 'outdated'] as const) {
  const picked = shuffle(samples[state]).slice(0, sampleCount);
  if (picked.length === 0) continue;
  console.log(`\nSample ${state} comments (check that the + lines are the right code):`);
  for (const s of picked) console.log(`\n  ${s}`);
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
