// Lints the docs in the current directory, which `npm run lint:docs` sets to
// the repo root. It checks that decisions and research don't share numbers,
// then runs remark with .remarkrc.js to check local Markdown links. It never
// changes files. See the Checks section of AGENTS.md.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { findDuplicateNumbers } from './check-doc-numbers.ts';

const root = process.cwd();
let failed = false;

const problems = findDuplicateNumbers(root);
for (const problem of problems) {
  console.error(problem);
}
if (problems.length > 0) {
  console.error(
    'Move the newer doc to the next free number, and update the links to it ' +
      'and its row in the index. See .rules/decisions.md and .rules/research.md.\n',
  );
  failed = true;
}

// This repo's root, which holds the tooling. The checked folder can differ in
// tests.
const tooling = path.join(import.meta.dirname, '..');
const remark = spawnSync(
  process.execPath,
  [
    path.join(tooling, 'node_modules', 'remark-cli', 'cli.js'),
    '.',
    // Check only the files Prettier checks.
    '--ignore-path',
    '.gitignore',
    // Use this repo's config, and not one found in the checked folder.
    '--rc-path',
    path.join(tooling, '.remarkrc.js'),
    '--no-config',
    // Fail on warnings, list only files with problems, and never print or
    // write the Markdown.
    '--frail',
    '--quiet',
    '--no-stdout',
    process.stderr.isTTY ? '--color' : '--no-color',
  ],
  { cwd: root, stdio: 'inherit' },
);
if (remark.status !== 0) {
  failed = true;
}

if (failed) {
  process.exitCode = 1;
}
