import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { findDuplicateNumbers } from '../check-doc-numbers.ts';

function repo(files: string[]): string {
  const root = mkdtempSync(path.join(tmpdir(), 'doc-numbers-'));
  mkdirSync(path.join(root, 'docs/decisions'), { recursive: true });
  mkdirSync(path.join(root, 'docs/research'), { recursive: true });
  for (const file of files) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), '# Doc\n');
  }
  return root;
}

test('passes when each folder numbers its docs once', () => {
  const root = repo([
    'docs/decisions/README.md',
    'docs/decisions/0001-a.md',
    'docs/decisions/0002-b.md',
    'docs/research/README.md',
    'docs/research/0001-a.md',
    'docs/research/0002-b.md',
  ]);
  assert.deepEqual(findDuplicateNumbers(root), []);
});

test('fails when two research docs share a number', () => {
  const root = repo([
    'docs/research/0001-a.md',
    'docs/research/0002-b.md',
    'docs/research/0002-c.md',
  ]);
  assert.deepEqual(findDuplicateNumbers(root), [
    'docs/research: 2 docs use number 2: docs/research/0002-b.md, docs/research/0002-c.md',
  ]);
});

test('fails when two decisions share a number', () => {
  const root = repo([
    'docs/decisions/0013-a.md',
    'docs/decisions/0013-b.md',
    'docs/decisions/0013-c.md',
  ]);
  assert.deepEqual(findDuplicateNumbers(root), [
    'docs/decisions: 3 docs use number 13: docs/decisions/0013-a.md, docs/decisions/0013-b.md, docs/decisions/0013-c.md',
  ]);
});

test('compares numbers as numbers', () => {
  const root = repo(['docs/research/0002-a.md', 'docs/research/2-b.md']);
  assert.deepEqual(findDuplicateNumbers(root), [
    'docs/research: 2 docs use number 2: docs/research/0002-a.md, docs/research/2-b.md',
  ]);
});

test('reports each folder and each number separately', () => {
  const root = repo([
    'docs/decisions/0001-a.md',
    'docs/decisions/0001-b.md',
    'docs/research/0001-a.md',
    'docs/research/0001-b.md',
    'docs/research/0003-a.md',
    'docs/research/0003-b.md',
  ]);
  assert.equal(findDuplicateNumbers(root).length, 3);
});

test('lets a decision and a research doc share a number', () => {
  const root = repo(['docs/decisions/0002-a.md', 'docs/research/0002-a.md']);
  assert.deepEqual(findDuplicateNumbers(root), []);
});

test('ignores README.md, subfolders, files in them, and other file types', () => {
  const root = repo([
    'docs/research/README.md',
    'docs/research/0002-a.md',
    'docs/research/0002-a/0002-notes.md',
    'docs/research/0002-diagram.png',
  ]);
  mkdirSync(path.join(root, 'docs/research/0002-b.md'));
  assert.deepEqual(findDuplicateNumbers(root), []);
});
