// Layered comment re-anchoring from docs/decisions/0008-comment-reanchoring.md.
// Always compares the original file version with the current one, never a chain.

import { diffArrays } from 'diff';

export type AnchorState = 'current' | 'moved' | 'outdated';

/** 1-based, inclusive line range. */
export interface LineRange {
  start: number;
  end: number;
}

export interface ReanchorOptions {
  /** Lines of surrounding context compared during content matching. */
  contextLines: number;
  /**
   * Minimum average line similarity (0 to 1) for the commented lines to count
   * as found elsewhere. 1 means an exact match after whitespace normalization.
   */
  minSimilarity: number;
  /**
   * Anchors with fewer non-whitespace characters than this must also have
   * matching context, so short lines like `}` aren't matched just anywhere.
   */
  minAnchorChars: number;
  minContextSimilarity: number;
  /**
   * If another candidate's similarity is within this margin of the best
   * one's, the match is ambiguous and the comment is marked outdated.
   */
  ambiguityMargin: number;
  /** Largest rank reduction, for a candidate a whole file away from the predicted position. */
  distancePenalty: number;
}

export const defaultReanchorOptions: ReanchorOptions = {
  contextLines: 3,
  minSimilarity: 0.9,
  minAnchorChars: 24,
  minContextSimilarity: 0.5,
  ambiguityMargin: 0.05,
  distancePenalty: 0.05,
};

export interface ReanchorResult {
  state: AnchorState;
  /** Where the comment sits in the current version. Set for current and moved. */
  range: LineRange | null;
  /**
   * For outdated comments, the current code that replaced the commented
   * lines. Null when the lines were removed with nothing in their place.
   */
  replacement: LineRange | null;
  /**
   * For outdated comments with no replacement, the current line the removed
   * lines followed (0 means the top of the file).
   */
  insertAfter: number | null;
  /** Shift applied to a current comment, or the similarity score of a moved match. */
  shift: number | null;
  similarity: number | null;
  reason: string;
}

export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function reanchor(
  original: string,
  range: LineRange,
  current: string | null,
  options: Partial<ReanchorOptions> = {},
): ReanchorResult {
  const opts = { ...defaultReanchorOptions, ...options };
  const orig = splitLines(original);
  if (range.start < 1 || range.end < range.start || range.end > orig.length) {
    throw new Error(
      `range ${range.start}-${range.end} is outside the original file (${orig.length} lines)`,
    );
  }
  if (current === null) {
    return outdated(null, 'The file no longer exists in this version.');
  }
  const cur = splitLines(current);
  const s = range.start - 1;
  const e = range.end - 1;

  // Layer 1: diff mapping.
  const map = mapLines(orig, cur);
  const first = map[s];
  const last = map[e];
  let allMapped = true;
  for (let i = s; i <= e; i++) {
    if (map[i] < 0) {
      allMapped = false;
      break;
    }
  }
  if (allMapped && last - first === e - s) {
    const shift = first - s;
    return {
      state: 'current',
      range: { start: first + 1, end: last + 1 },
      replacement: null,
      insertAfter: null,
      shift,
      similarity: 1,
      reason:
        shift === 0
          ? 'Commented lines are unchanged.'
          : `Commented lines are unchanged and moved ${shift > 0 ? 'down' : 'up'} ${Math.abs(shift)} line(s).`,
    };
  }

  const region = replacementRegion(map, s, e, cur.length);

  // Layer 2: content matching.
  const n = e - s + 1;
  const origNorm = orig.map(normalize);
  const curNorm = cur.map(normalize);
  const anchor = origNorm.slice(s, e + 1);
  const anchorChars = anchor.join('').replace(/\s/g, '').length;
  const weak = anchorChars < opts.minAnchorChars;
  const sim = similarityCache();

  interface Candidate {
    start: number;
    similarity: number;
    context: number;
    rank: number;
    exact: boolean;
  }
  const candidates: Candidate[] = [];
  for (let c = 0; c + n <= cur.length; c++) {
    let sum = 0;
    let exact = true;
    let pruned = false;
    for (let i = 0; i < n; i++) {
      const v = sim(anchor[i], curNorm[c + i]);
      if (v < 1) exact = false;
      sum += v;
      if ((sum + (n - 1 - i)) / n < opts.minSimilarity) {
        pruned = true;
        break;
      }
    }
    if (pruned) continue;
    const similarity = sum / n;
    if (similarity < opts.minSimilarity) continue;

    // A fuzzy match over the code that replaced the commented lines is the
    // "agent edited exactly these lines" case. That must read as outdated.
    const overlapsRegion =
      region.end >= region.start &&
      c <= region.end &&
      c + n - 1 >= region.start;
    if (!exact && overlapsRegion) continue;

    const context = contextSimilarity(
      origNorm,
      s,
      e,
      curNorm,
      c,
      c + n - 1,
      opts.contextLines,
      sim,
    );
    if (weak && context < opts.minContextSimilarity) continue;

    const distance = Math.abs(c - region.start) / Math.max(1, cur.length);
    const rank =
      similarity * 0.7 +
      context * 0.3 -
      opts.distancePenalty * Math.min(1, distance);
    candidates.push({ start: c, similarity, context, rank, exact });
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => b.rank - a.rank);
    const best = candidates[0];
    // Rivals are judged on content alone. Context only breaks ties in ranking,
    // because two copies of the same code are a guess no matter where they sit.
    const rival = candidates.find(
      (cand) =>
        Math.abs(cand.start - best.start) >= n &&
        cand.similarity >= best.similarity - opts.ambiguityMargin,
    );
    if (rival) {
      return outdated(
        region,
        `Commented lines changed. ${candidates.length} possible matches, best at line ${best.start + 1} and a close rival at line ${rival.start + 1}, so the match is ambiguous.`,
      );
    }
    return {
      state: 'moved',
      range: { start: best.start + 1, end: best.start + n },
      replacement: null,
      insertAfter: null,
      shift: best.start - s,
      similarity: round(best.similarity),
      reason: `Commented lines changed or moved; ${best.exact ? 'an exact' : 'a close'} match was found at line ${best.start + 1} (similarity ${round(best.similarity)}, context ${round(best.context)}).`,
    };
  }

  // Layer 3: outdated.
  return outdated(
    region,
    'Commented lines changed and no confident match was found.',
  );
}

function outdated(
  region: { start: number; end: number } | null,
  reason: string,
): ReanchorResult {
  const hasReplacement = region !== null && region.end >= region.start;
  return {
    state: 'outdated',
    range: null,
    replacement: hasReplacement
      ? { start: region.start + 1, end: region.end + 1 }
      : null,
    insertAfter: region !== null && !hasReplacement ? region.start : null,
    shift: null,
    similarity: null,
    reason,
  };
}

/** For each original line, its index in the current version, or -1 if it was removed or changed. */
export function mapLines(orig: string[], cur: string[]): Int32Array {
  const map = new Int32Array(orig.length).fill(-1);
  let oi = 0;
  let ni = 0;
  for (const change of diffArrays(orig, cur)) {
    if (change.added) {
      ni += change.count;
    } else if (change.removed) {
      oi += change.count;
    } else {
      for (let k = 0; k < change.count; k++) map[oi + k] = ni + k;
      oi += change.count;
      ni += change.count;
    }
  }
  return map;
}

/**
 * 0-based range of current lines between the nearest unchanged lines around
 * the commented range. End < start means the lines were removed outright.
 */
function replacementRegion(
  map: Int32Array,
  s: number,
  e: number,
  curLength: number,
): { start: number; end: number } {
  let start = 0;
  for (let i = s - 1; i >= 0; i--) {
    if (map[i] >= 0) {
      start = map[i] + 1;
      break;
    }
  }
  let end = curLength - 1;
  for (let j = e + 1; j < map.length; j++) {
    if (map[j] >= 0) {
      end = map[j] - 1;
      break;
    }
  }
  return { start, end };
}

function contextSimilarity(
  orig: string[],
  s: number,
  e: number,
  cur: string[],
  cs: number,
  ce: number,
  k: number,
  sim: (a: string, b: string) => number,
): number {
  if (k === 0) return 1;
  let total = 0;
  for (let j = 1; j <= k; j++) {
    total += pair(orig[s - j], cur[cs - j], sim);
    total += pair(orig[e + j], cur[ce + j], sim);
  }
  return total / (2 * k);
}

function pair(
  a: string | undefined,
  b: string | undefined,
  sim: (a: string, b: string) => number,
): number {
  if (a === undefined && b === undefined) return 1;
  if (a === undefined || b === undefined) return 0;
  return sim(a, b);
}

function normalize(line: string): string {
  return line.trim().replace(/\s+/g, ' ');
}

/** Dice coefficient over character bigrams, cached per line. */
function similarityCache(): (a: string, b: string) => number {
  const cache = new Map<string, Map<string, number>>();
  const grams = (s: string) => {
    let m = cache.get(s);
    if (!m) {
      m = new Map();
      for (let i = 0; i < s.length - 1; i++) {
        const g = s.slice(i, i + 2);
        m.set(g, (m.get(g) ?? 0) + 1);
      }
      cache.set(s, m);
    }
    return m;
  };
  return (a, b) => {
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;
    const ga = grams(a);
    const gb = grams(b);
    let overlap = 0;
    for (const [g, count] of ga) overlap += Math.min(count, gb.get(g) ?? 0);
    return (2 * overlap) / (a.length - 1 + (b.length - 1));
  };
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
