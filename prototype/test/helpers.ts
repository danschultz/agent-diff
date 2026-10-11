import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const prototypeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratchRoot = path.join(prototypeDir, '.data', 'test-repos');

export interface TestRepo {
  dir: string;
  dataDir: string;
  git: (...args: string[]) => string;
  write: (file: string, content: string) => void;
  cleanup: () => void;
}

/** Creates a throwaway repo inside prototype/.data so tests never write outside the project. */
export function makeRepo(): TestRepo {
  mkdirSync(scratchRoot, { recursive: true });
  const base = realpathSync(mkdtempSync(path.join(scratchRoot, 'repo-')));
  const dir = path.join(base, 'repo');
  const dataDir = path.join(base, 'data');
  mkdirSync(dir);
  mkdirSync(dataDir);
  // GIT_OPTIONAL_LOCKS=0 stops the tests' own `git status` from refreshing the index.
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_OPTIONAL_LOCKS: '0' };
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env });
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  git('config', 'commit.gpgsign', 'false');
  const write = (file: string, content: string) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), content);
  };
  return { dir, dataDir, git, write, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}
