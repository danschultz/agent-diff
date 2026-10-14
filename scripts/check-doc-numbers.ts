// Fails when two decisions, or two research docs, have the same number. Each
// folder has its own sequence, and only `.md` files directly in it are
// checked, other than README.md. Run by scripts/lint-docs.ts.

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const folders = ['docs/decisions', 'docs/research'];

// Returns one message for each number that more than one doc uses.
export function findDuplicateNumbers(root: string): string[] {
  const problems: string[] = [];

  for (const folder of folders) {
    if (!existsSync(path.join(root, folder))) {
      continue;
    }
    const byNumber = new Map<number, string[]>();
    const entries = readdirSync(path.join(root, folder), {
      withFileTypes: true,
    });

    for (const entry of entries) {
      const match = /^(\d+)/.exec(entry.name);
      if (!entry.isFile() || !entry.name.endsWith('.md') || !match) {
        continue;
      }
      const number = Number(match[1]);
      const names = byNumber.get(number) ?? [];
      names.push(entry.name);
      byNumber.set(number, names);
    }

    for (const [number, names] of [...byNumber].sort((a, b) => a[0] - b[0])) {
      if (names.length > 1) {
        const files = names.sort().map((name) => `${folder}/${name}`);
        problems.push(
          `${folder}: ${files.length} docs use number ${number}: ${files.join(', ')}`,
        );
      }
    }
  }

  return problems;
}
