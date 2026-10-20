// Naming a brief's branch. Briefs themselves are Aven tasks; see aven.ts.

import { randomBytes } from 'node:crypto';

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

/**
 * A short random suffix that keeps branch names unique. It's not derived from
 * the task, so nothing on GitHub identifies the brief's Aven task.
 */
export function randomSuffix(): string {
  return randomBytes(3).toString('hex');
}
