// A session's All changes diff on the session page, from decisions 0044 and
// 0045, over repos the tests set up with git.
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import { agentDiff, test, withOrigin } from './helpers.ts';

const dirs: string[] = [];
test.afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}

function write(dir: string, files: Record<string, string | Buffer>): void {
  for (const [file, contents] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), contents);
  }
}

function lines(count: number, prefix = 'line'): string {
  return Array.from({ length: count }, (_, i) => `${prefix} ${i + 1}\n`).join(
    '',
  );
}

// A repo with the files committed on main, and the branch feature checked
// out with the changes written to its working tree, not committed.
function makeRepo(
  env: NodeJS.ProcessEnv,
  committed: Record<string, string | Buffer>,
  changes: Record<string, string | Buffer> = {},
): string {
  const repo = tempDir('agent-diff-e2e-diff-');
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: repo, env, stdio: 'ignore' });
  git('init', '--quiet', '--initial-branch', 'main');
  write(repo, committed);
  git('add', '--all');
  git(
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '--quiet',
    '--allow-empty',
    '--message',
    'Commit',
  );
  git('switch', '--quiet', '--create', 'feature');
  write(repo, changes);
  return repo;
}

// Starts a session over the working directories, and returns its link.
function newSession(env: NodeJS.ProcessEnv, ...dirs: string[]): string {
  const output = agentDiff(env, 'session', 'new', ...dirs);
  const url = /^Review UI: (\S+)$/m.exec(output)?.[1];
  if (!url) throw new Error(`Unexpected output:\n${output}`);
  return url;
}

function workingDirectory(page: Page, dir: string): Locator {
  return page
    .getByRole('region', { name: 'Changes' })
    .getByRole('region', { name: dir, exact: true });
}

function file(scope: Page | Locator, name: string): Locator {
  return scope.getByRole('region', { name, exact: true });
}

// The editors mounted on the page, one per file near the visible area.
function editors(page: Page): Locator {
  return page.locator('.cm-editor');
}

test('every changed file shows in one diff, with its status and line counts', async ({
  page,
  env,
  reviewServer,
}) => {
  void reviewServer;
  const repo = makeRepo(
    env,
    {
      'src/changed.ts': lines(20),
      'deleted.txt': 'gone\n',
      'old-name.txt': lines(5),
    },
    {
      'src/changed.ts': lines(20).replace('line 10\n', 'line ten\n'),
      'untracked.md': '# New\n\nText\n',
    },
  );
  execFileSync('git', ['rm', '--quiet', 'deleted.txt'], { cwd: repo, env });
  execFileSync('git', ['mv', 'old-name.txt', 'new-name.txt'], {
    cwd: repo,
    env,
  });
  await page.goto(newSession(env, repo));

  const changes = workingDirectory(page, repo);
  await expect(changes.getByRole('heading')).toHaveText(repo);
  await expect(changes.locator('.file-header')).toHaveText([
    'deleteddeleted.txt+0 −1',
    'renamedold-name.txt → new-name.txt+0 −0',
    'modifiedsrc/changed.ts+1 −1',
    'untrackeduntracked.md+3 −0',
  ]);
  await expect(editors(page)).toHaveCount(4);
});

test('a diff has 3 lines of context, and old line numbers on removed lines', async ({
  page,
  env,
  reviewServer,
}) => {
  void reviewServer;
  const repo = makeRepo(
    env,
    { 'a.txt': lines(20) },
    { 'a.txt': lines(20).replace('line 10\n', 'line ten\n') },
  );
  await page.goto(newSession(env, repo));
  const diff = file(page, 'a.txt');
  await expect(diff.locator('.cm-collapsedLines')).toHaveText([
    /6 unchanged lines/,
    /7 unchanged lines/,
  ]);
  await expect(diff.locator('.cm-deletedLine')).toHaveText(['line 10']);
  await expect(diff.locator('.cm-oldLineNumbers')).toHaveText('10');
  await expect(diff.locator('.cm-line')).toHaveText([
    'line 7',
    'line 8',
    'line 9',
    'line ten',
    'line 11',
    'line 12',
    'line 13',
  ]);
  // The new side's line numbers, with the old line number of the removed
  // line before the line that replaced it.
  const numbers = await diff
    .locator('.cm-lineNumbers .cm-gutterElement')
    .allInnerTexts();
  expect(numbers.filter((n) => n !== '')).toEqual([
    '7',
    '8',
    '9',
    '10',
    '10',
    '11',
    '12',
    '13',
  ]);
});

test('binary files, files over 2 MB, and submodules show a placeholder', async ({
  page,
  env,
  reviewServer,
}) => {
  void reviewServer;
  const large = lines(200_000);
  const repo = makeRepo(
    env,
    { 'image.png': Buffer.from([0x89, 0, 1]), 'large.txt': large },
    { 'image.png': Buffer.from([0x89, 0, 2]), 'large.txt': `${large}more\n` },
  );
  const nested = path.join(repo, 'nested');
  mkdirSync(nested);
  execFileSync('git', ['init', '--quiet'], { cwd: nested, env });
  await page.goto(newSession(env, repo));
  await expect(file(page, 'image.png').locator('.file-note')).toHaveText(
    "This file is binary, so its diff isn't shown.",
  );
  await expect(file(page, 'large.txt').locator('.file-note')).toHaveText(
    "This file is over 2 MB, so its diff isn't shown.",
  );
  await expect(file(page, 'nested').locator('.file-note')).toHaveText(
    "This is a submodule, so there's no diff to show.",
  );
  await expect(file(page, 'large.txt').locator('.line-counts')).toHaveText(
    '+1 −0',
  );
  await expect(editors(page)).toHaveCount(0);
});

test('working directories are grouped in the order they were added, with notes for those without a diff', async ({
  page,
  env,
  reviewServer,
}) => {
  void reviewServer;
  const second = makeRepo(env, { 'b.txt': 'b\n' }, { 'b.txt': 'B\n' });
  const first = makeRepo(env, { 'a.txt': 'a\n' }, { 'a.txt': 'A\n' });
  const unchanged = makeRepo(env, { 'c.txt': 'c\n' });
  const plain = tempDir('agent-diff-e2e-plain-');
  const missing = tempDir('agent-diff-e2e-missing-');
  const url = newSession(env, second, first, unchanged, plain, missing);
  rmSync(missing, { recursive: true });
  await page.goto(url);

  const changes = page.getByRole('region', { name: 'Changes' });
  await expect(changes.getByRole('heading', { level: 3 })).toHaveText([
    second,
    first,
    unchanged,
    plain,
    missing,
  ]);
  await expect(file(workingDirectory(page, second), 'b.txt')).toBeVisible();
  await expect(file(workingDirectory(page, first), 'a.txt')).toBeVisible();
  await expect(workingDirectory(page, unchanged)).toContainText('No changes.');
  await expect(workingDirectory(page, plain)).toContainText(
    "This working directory doesn't use git, so it has no diff, and its files aren't listed yet.",
  );
  await expect(workingDirectory(page, missing)).toContainText(
    "This working directory doesn't exist anymore.",
  );
});

test('an archived session shows the current diff', async ({
  page,
  env,
  reviewServer,
}) => {
  void reviewServer;
  const repo = makeRepo(env, { 'a.txt': 'a\n' }, { 'a.txt': 'A\n' });
  const url = newSession(env, repo);
  const id = /sessions\/(s_[0-9a-z]+)/.exec(url)![1]!;
  agentDiff(env, 'session', 'archive', id);
  write(repo, { 'a.txt': 'changed after archiving\n' });
  await page.goto(url);
  await expect(page.getByTestId('status')).toHaveText(/^Archived on/);
  await expect(file(page, 'a.txt').locator('.cm-line')).toHaveText([
    'changed after archiving',
  ]);
});

test('TypeScript is highlighted, and a file with an unknown extension is plain text', async ({
  page,
  env,
  reviewServer,
}) => {
  void reviewServer;
  const code = 'export const answer: number = 42;\n';
  const repo = makeRepo(env, {}, { 'a.ts': code, 'a.unknown-ext': code });
  await page.goto(newSession(env, repo));
  // CodeMirror's highlight style gives tokens generated classes, which start
  // with ͼ, and its own classes start with cm-.
  const tokens = (name: string) =>
    file(page, name).locator('.cm-content span[class^="ͼ"]');
  await expect(tokens('a.ts').first()).toBeVisible();
  await expect(file(page, 'a.unknown-ext').locator('.cm-line')).toHaveText(
    code.trim(),
  );
  await expect(tokens('a.unknown-ext')).toHaveCount(0);
});

test("a file's header sticks to the top while the file is in view", async ({
  page,
  env,
  reviewServer,
}) => {
  void reviewServer;
  const repo = makeRepo(env, {}, { 'long.txt': lines(300), 'z.txt': 'z\n' });
  await page.goto(newSession(env, repo));
  const long = file(page, 'long.txt');
  await expect(long.locator('.cm-editor')).toBeVisible();
  const box = (await long.boundingBox())!;
  await page.evaluate(`window.scrollTo(0, ${box.y + box.height / 2})`);
  await expect
    .poll(async () => (await long.locator('.file-header').boundingBox())?.y)
    .toBe(0);
  await expect(long.locator('.file-header')).toBeInViewport();
});

test('the diff shows on the dev server', async ({
  page,
  env,
  reviewServer,
  devServer,
}) => {
  void reviewServer;
  const repo = makeRepo(env, { 'a.ts': 'a\n' }, { 'a.ts': 'A\n' });
  await page.goto(withOrigin(newSession(env, repo), devServer.origin));
  await expect(file(page, 'a.ts').locator('.cm-line')).toHaveText(['A']);
  await expect(file(page, 'a.ts').locator('.cm-deletedLine')).toHaveText(['a']);
});

// The top of each file in the visible area, relative to the window, by path.
// Section tops, since headers stick to the top.
async function visibleFileTops(page: Page): Promise<Record<string, number>> {
  return page.evaluate(`(() => {
    const tops = {};
    for (const section of document.querySelectorAll('.file-diff')) {
      const { top } = section.getBoundingClientRect();
      if (top >= 0 && top < window.innerHeight) {
        tops[section.getAttribute('aria-label')] = top;
      }
    }
    return tops;
  })()`);
}

// Scrolls by delta, and checks the files in view moved by exactly as much as
// the window scrolled, so nothing mounting or unmounting moved them. Returns
// how far the window scrolled, which is less than delta at either end. The
// distance is read in the same task as the scroll, since the browser's
// scroll anchoring changes the scroll position afterwards to keep the files
// in view where they are when files above them change height.
async function scrollBy(page: Page, delta: number): Promise<number> {
  const before = await visibleFileTops(page);
  const scrolled = (await page.evaluate(`(() => {
    const y = window.scrollY;
    window.scrollBy(0, ${delta});
    return window.scrollY - y;
  })()`)) as number;
  // Long enough for editors to mount and unmount, and to be measured.
  await page.waitForTimeout(150);
  await page.evaluate(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  const after = await visibleFileTops(page);
  for (const [name, top] of Object.entries(before)) {
    if (name in after) {
      expect(Math.abs(after[name]! - (top - scrolled)), name).toBeLessThan(2);
    }
  }
  return scrolled;
}

test('with 300 changed files, only files near the visible area have an editor, and scrolling never jumps', async ({
  page,
  env,
  reviewServer,
}) => {
  test.setTimeout(240_000);
  void reviewServer;
  const committed: Record<string, string> = {};
  const changed: Record<string, string> = {};
  for (let i = 0; i < 300; i++) {
    const name = `file-${String(i).padStart(3, '0')}.txt`;
    committed[name] = lines(10, name);
    changed[name] = committed[name].replace(`${name} 1\n`, 'changed\n');
  }
  const repo = makeRepo(env, committed, changed);
  await page.setViewportSize({ width: 1280, height: 1200 });
  await page.goto(newSession(env, repo));
  await expect(file(page, 'file-000.txt').locator('.cm-editor')).toBeVisible();
  await expect(page.locator('.file-diff')).toHaveCount(300);

  // Each file is about 180 px tall, so the 1,200 px window and 1,200 px
  // below it hold about 13 files, and 4,000 px above and below it about 50.
  const mounted = async () => editors(page).count();
  expect(await mounted()).toBeGreaterThan(5);
  expect(await mounted()).toBeLessThan(30);

  const first = file(page, 'file-000.txt');
  // Once CodeMirror has measured the editor's lines.
  await page.evaluate(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  const mountedHeight = (await first.boundingBox())!.height;

  // To the end, and back to the top.
  for (const delta of [1000, -1000]) {
    while ((await scrollBy(page, delta)) !== 0) {
      expect(await mounted()).toBeLessThan(80);
    }
    if (delta > 0) {
      // Each file's contents are fetched as its editor mounts, and the
      // review server runs git for each one.
      await expect(
        file(page, 'file-299.txt').locator('.cm-editor'),
      ).toBeInViewport({ timeout: 15_000 });
      await expect(first.locator('.cm-editor')).toHaveCount(0);
      // An unmounted file keeps the height it had with its editor.
      expect((await first.boundingBox())!.height).toBe(mountedHeight);
    }
  }
  expect(await page.evaluate('window.scrollY')).toBe(0);
  await expect(file(page, 'file-000.txt').locator('.cm-editor')).toBeVisible({
    timeout: 15_000,
  });
  await expect(file(page, 'file-299.txt').locator('.cm-editor')).toHaveCount(0);
});
