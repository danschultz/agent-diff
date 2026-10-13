// Parsing briefs written from .github/ISSUE_TEMPLATE/brief.yml.

export interface BriefField {
  label: string;
  required: boolean;
}

/** The fields of the brief issue template, in order. Labels must match brief.yml. */
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
 * Splits an issue form body into its fields. GitHub renders each field as a
 * `### Label` heading followed by the answer, or `_No response_` when empty.
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

/** A short branch-safe slug from an issue title. */
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
