import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';

/**
 * The environment for a test that runs git, built from nothing instead of
 * from `process.env`. Git exports variables such as `GIT_DIR` and
 * `GIT_INDEX_FILE` to hooks, and a test that inherited them would change the
 * repo being committed instead of its own temporary one. `HOME` is a new
 * temporary folder, and git reads no global or system config, so the user's
 * own settings, such as `commit.gpgsign` or `core.hooksPath`, don't apply
 * either. Add anything else a test needs on top of this, and pass it to child
 * processes that run git, such as `lint-docs.ts`.
 */
export function gitTestEnv(t: TestContext): NodeJS.ProcessEnv {
  const home = mkdtempSync(path.join(os.tmpdir(), 'lint-docs-home-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return {
    PATH: process.env.PATH,
    HOME: home,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
  };
}
