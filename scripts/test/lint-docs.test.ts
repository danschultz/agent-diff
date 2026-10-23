import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { suite, test, type TestContext } from 'node:test';
import { gitTestEnv } from './git-env.ts';

const lintDocs = path.join(import.meta.dirname, '..', 'lint-docs.ts');

// Creates a git repo with no `origin` remote in a new temporary folder, which
// also holds `outside.md`, a file outside the repo. Returns the repo, and the
// environment to run git and the lint in.
function repo(
  t: TestContext,
  files: Record<string, string>,
): { root: string; env: NodeJS.ProcessEnv } {
  const base = mkdtempSync(path.join(tmpdir(), 'lint-docs-'));
  writeFileSync(path.join(base, 'outside.md'), '# Outside\n');
  const root = path.join(base, 'repo');
  const all: Record<string, string> = {
    '.gitignore': 'ignored/\n',
    'docs/decisions/README.md': '# Decisions\n',
    'docs/decisions/0001-a.md': '# 0001: A\n',
    'docs/research/README.md': '# Research\n',
    'docs/research/0001-a.md': '# 0001: A\n',
    ...files,
  };
  for (const [file, content] of Object.entries(all)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }
  const env = gitTestEnv(t);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root, env });
  return { root, env };
}

// Runs `lint-docs.ts` in a child process, which runs `git check-ignore`.
function lint({
  root,
  env,
}: {
  root: string;
  env: NodeJS.ProcessEnv;
}): Promise<{ status: number; output: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [lintDocs],
      { cwd: root, env, encoding: 'utf8' },
      (error, stdout, stderr) => {
        const status = error ? Number(error.code) : 0;
        resolve({ status, output: stdout + stderr });
      },
    );
  });
}

function snapshot(root: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const entry of readdirSync(root, { recursive: true })) {
    const file = path.join(root, String(entry));
    if (!file.includes(`${path.sep}.git${path.sep}`) && file.endsWith('.md')) {
      files.set(file, readFileSync(file, 'utf8'));
    }
  }
  return files;
}

// Each test runs the lint in its own repo, so they can run at the same time.
suite('lint-docs', { concurrency: true }, () => {
  test('passes on valid links, and ignores links in code and to other schemes', async (t) => {
    const { root, env } = repo(t, {
      'docs/research/0002-b.md': '# 0002: B\n',
      'docs/research/0002-b/notes.md': '# Notes\n',
      'docs/decisions/0002-b.md': '# 0002: B\n',
      'image.png': '',
      'README.md': [
        '# Readme',
        '',
        '## Intro',
        '',
        '## Intro',
        '',
        '## Punctuation, too!',
        '',
        '[same file](#readme) [repeated](#intro-1) [punctuation](#punctuation-too)',
        '[other file](docs/research/0002-b.md#0002-b) [folder](docs/research/0002-b)',
        '[reference][ref] ![image](image.png) [query](docs/decisions/README.md?plain=1)',
        '[web](https://example.com/missing.md) [mail](mailto:dan@example.com)',
        '',
        '`[inline](missing.md)` `[outside](../outside.md)` `[absolute](/README.md)`',
        '',
        '```md',
        '[block](missing.md#nope) [outside](../outside.md) [absolute](/README.md)',
        '```',
        '',
        '[ref]: docs/research/0002-b/notes.md#notes',
        '',
      ].join('\n'),
      'ignored/broken.md': '[broken](missing.md) [outside](../../outside.md)\n',
    });
    const before = snapshot(root);
    const { status, output } = await lint({ root, env });
    assert.equal(output, '');
    assert.equal(status, 0);
    assert.deepEqual(snapshot(root), before);
  });

  test('fails on broken links, links outside the repo, and ignored targets', async (t) => {
    const lines = [
      '# Bad',
      '',
      '## Twice',
      '',
      '## Twice',
      '',
      '[missing file](missing.md)',
      '[missing heading](other.md#nope)',
      '[missing heading here](#nope)',
      '[repeated heading](#twice-2)',
      '[missing reference target][ref]',
      '![missing image](missing.png)',
      '[ignored](ignored/exists.md)',
      '[outside](../outside.md)',
      '[absolute](/other.md)',
      '[file url](file:///etc/hosts)',
      '',
      '[ref]: missing-ref.md',
      '',
    ];
    const { root, env } = repo(t, {
      'bad.md': lines.join('\n'),
      'other.md': '# Other\n',
      'ignored/exists.md': '# Exists\n',
    });
    const before = snapshot(root);
    const { status, output } = await lint({ root, env });
    assert.equal(status, 1);
    assert.deepEqual(snapshot(root), before);

    const at = (text: string) => lines.indexOf(text) + 1 + ':1';
    const expected = [
      [at('[missing file](missing.md)'), 'Cannot find file `missing.md`'],
      [
        at('[missing heading](other.md#nope)'),
        'Cannot find heading for `#nope` in `other.md`',
      ],
      [at('[missing heading here](#nope)'), 'Cannot find heading for `#nope`'],
      [
        at('[repeated heading](#twice-2)'),
        'Cannot find heading for `#twice-2`',
      ],
      [at('[ref]: missing-ref.md'), 'Cannot find file `missing-ref.md`'],
      [at('![missing image](missing.png)'), 'Cannot find file `missing.png`'],
      [
        at('[ignored](ignored/exists.md)'),
        'Link `ignored/exists.md` points to `ignored/exists.md`, which git ignores',
      ],
      [
        at('[outside](../outside.md)'),
        'Link `../outside.md` points outside the repo',
      ],
      [
        at('[absolute](/other.md)'),
        'Link `/other.md` is an absolute path; use a path relative to this file',
      ],
      [
        at('[file url](file:///etc/hosts)'),
        'Link `file:///etc/hosts` is a `file:` URL; link to a file in the repo',
      ],
    ];
    assert.match(output, /^bad\.md$/m);
    for (const [place, message] of expected) {
      const line = output
        .split('\n')
        .find(
          (line) =>
            line.trim().startsWith(place + '-') && line.includes(message),
        );
      assert.ok(line, `expected ${place} ${message} in:\n${output}`);
    }
    assert.match(output, /10 warnings/);
  });

  test('fails on links from a skill to a rule, but not from a rule to a skill', async (t) => {
    const lines = [
      '# Skill',
      '',
      '[rule](../../../.rules/a.md)',
      '[rules folder](../../../.rules)',
      '[rule reference][ref]',
      '[glossary](../../../docs/glossary.md)',
      '[other skill](../other/SKILL.md)',
      '`[code](../../../.rules/a.md)`',
      '',
      '[ref]: ../../../.rules/a.md#a',
      '',
    ];
    const { root, env } = repo(t, {
      '.claude/skills/one/SKILL.md': lines.join('\n'),
      '.claude/skills/other/SKILL.md': '# Other\n',
      '.rules/a.md': '# A\n\n[skill](../.claude/skills/one/SKILL.md)\n',
      'docs/glossary.md': '# Glossary\n',
    });
    const { status, output } = await lint({ root, env });
    assert.equal(status, 1);

    const at = (text: string) => lines.indexOf(text) + 1 + ':1';
    const expected = [
      [at('[rule](../../../.rules/a.md)'), '../../../.rules/a.md'],
      [at('[rules folder](../../../.rules)'), '../../../.rules'],
      [at('[ref]: ../../../.rules/a.md#a'), '../../../.rules/a.md#a'],
    ];
    assert.match(output, /^\.claude\/skills\/one\/SKILL\.md$/m);
    assert.doesNotMatch(output, /^\.rules\/a\.md$/m);
    for (const [place, url] of expected) {
      const message =
        'Link `' +
        url +
        "` points to a rule in `.rules/`; skills don't link to rules";
      const line = output
        .split('\n')
        .find(
          (line) =>
            line.trim().startsWith(place + '-') && line.includes(message),
        );
      assert.ok(line, `expected ${place} ${message} in:\n${output}`);
    }
    assert.match(output, /3 warnings/);
  });

  test('fails on shared numbers and broken links in the same run', async (t) => {
    const { root, env } = repo(t, {
      'docs/decisions/0001-b.md': '# 0001: B\n',
      'docs/research/1-b.md': '# 1: B\n',
      'README.md': '[missing](missing.md)\n',
    });
    const { status, output } = await lint({ root, env });
    assert.equal(status, 1);
    assert.match(
      output,
      /^docs\/decisions: 2 docs use number 1: docs\/decisions\/0001-a\.md, docs\/decisions\/0001-b\.md$/m,
    );
    assert.match(
      output,
      /^docs\/research: 2 docs use number 1: docs\/research\/0001-a\.md, docs\/research\/1-b\.md$/m,
    );
    assert.match(output, /^README\.md$/m);
    assert.match(output, /1:1-1:22 +warning +Cannot find file `missing\.md`/);
  });
});
