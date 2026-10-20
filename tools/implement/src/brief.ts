// Parsing a brief's headings, and naming its branch. Briefs themselves are
// Aven tasks; see aven.ts and .rules/briefs.md.

import { randomInt } from 'node:crypto';

export interface BriefField {
  label: string;
  required: boolean;
}

/** A brief's headings, in order. Labels must match .rules/briefs.md. */
export const BRIEF_FIELDS: BriefField[] = [
  { label: 'Goal', required: true },
  { label: 'Out of scope', required: false },
  { label: 'Context', required: false },
  { label: 'Acceptance criteria', required: true },
  { label: 'Verification', required: true },
  { label: 'Escalation criteria', required: false },
  { label: 'Notes', required: false },
];

/**
 * Splits a brief into its fields, each a `### Label` heading followed by its
 * text. `_No response_`, which GitHub's issue forms wrote for an empty field,
 * counts as empty, so briefs copied from issues parse the same way.
 */
export function parseBrief(body: string): Map<string, string> {
  const fields = new Map<string, string>();
  const known = new Set(BRIEF_FIELDS.map((f) => f.label.toLowerCase()));
  let current: string | undefined;
  let lines: string[] = [];
  const flush = () => {
    if (current === undefined) return;
    const value = lines.join('\n').trim();
    fields.set(current, value === '_No response_' ? '' : value);
  };
  for (const line of body.replace(/\r\n/g, '\n').split('\n')) {
    const heading = /^###\s+(.+?)\s*$/.exec(line);
    if (heading && known.has(heading[1].toLowerCase())) {
      flush();
      current = BRIEF_FIELDS.find(
        (f) => f.label.toLowerCase() === heading[1].toLowerCase(),
      )!.label;
      lines = [];
    } else if (current !== undefined) {
      lines.push(line);
    }
  }
  flush();
  return fields;
}

/** Labels of required fields that are missing or empty. */
export function missingFields(body: string): string[] {
  const fields = parseBrief(body);
  return BRIEF_FIELDS.filter((f) => f.required && !fields.get(f.label)).map(
    (f) => f.label,
  );
}

/** A short branch-safe slug from a brief's title. */
export function slugify(title: string, maxLength = 40): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length <= maxLength) return slug || 'brief';
  const cut = slug.slice(0, maxLength);
  const lastDash = cut.lastIndexOf('-');
  return (lastDash > maxLength / 2 ? cut.slice(0, lastDash) : cut).replace(
    /-+$/,
    '',
  );
}

export const VERBS = [
  'bake',
  'bend',
  'bloom',
  'bounce',
  'brew',
  'build',
  'carry',
  'carve',
  'catch',
  'chase',
  'chime',
  'climb',
  'coast',
  'craft',
  'dance',
  'dash',
  'dig',
  'dive',
  'draw',
  'drift',
  'fetch',
  'find',
  'float',
  'fly',
  'fold',
  'forge',
  'gather',
  'glide',
  'glow',
  'grow',
  'hike',
  'hum',
  'jump',
  'juggle',
  'kick',
  'knit',
  'launch',
  'leap',
  'lift',
  'mend',
  'mix',
  'paint',
  'plant',
  'polish',
  'pour',
  'race',
  'ring',
  'roam',
  'roll',
  'row',
  'sail',
  'scout',
  'sing',
  'sketch',
  'skip',
  'slide',
  'spin',
  'sweep',
  'swim',
  'toss',
  'track',
  'twirl',
  'wander',
  'weave',
];

export const NOUNS = [
  'acorn',
  'anchor',
  'apple',
  'badger',
  'banjo',
  'basil',
  'beacon',
  'birch',
  'bison',
  'bramble',
  'breeze',
  'brook',
  'cactus',
  'canoe',
  'canyon',
  'cedar',
  'comet',
  'coral',
  'cricket',
  'dune',
  'ember',
  'falcon',
  'fern',
  'fjord',
  'garnet',
  'gecko',
  'glacier',
  'harbor',
  'hazel',
  'heron',
  'island',
  'jasper',
  'kayak',
  'kettle',
  'kiwi',
  'lagoon',
  'lantern',
  'lemon',
  'lichen',
  'lotus',
  'maple',
  'meadow',
  'meteor',
  'moss',
  'nectar',
  'otter',
  'owl',
  'panda',
  'pebble',
  'pepper',
  'pine',
  'plum',
  'puffin',
  'quartz',
  'quill',
  'raven',
  'reef',
  'river',
  'robin',
  'saffron',
  'sparrow',
  'spruce',
  'tulip',
  'walnut',
];

/**
 * A random, memorable verb-noun suffix, such as `chase-otter`, that keeps
 * branch names unique. It's not derived from the task, so nothing on GitHub
 * identifies the brief's Aven task.
 */
export function randomSuffix(): string {
  return `${VERBS[randomInt(VERBS.length)]}-${NOUNS[randomInt(NOUNS.length)]}`;
}
