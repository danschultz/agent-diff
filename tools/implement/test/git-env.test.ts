import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import os from 'node:os';
import { test } from 'node:test';
import { gitTestEnv } from './git-env.ts';

test("the git test environment drops the caller's variables, and has its own HOME", (t) => {
  const set = {
    GIT_DIR: '/repo/.git/worktrees/wt',
    GIT_INDEX_FILE: '/repo/.git/worktrees/wt/index',
    GIT_CONFIG_PARAMETERS: "'user.name'='Hook'",
    FOO: 'bar',
  };
  const saved = Object.fromEntries(
    Object.keys(set).map((key) => [key, process.env[key]]),
  );
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  Object.assign(process.env, set);

  const env = gitTestEnv(t);
  for (const key of Object.keys(set)) assert.equal(env[key], undefined, key);
  assert.deepEqual(Object.keys(env).sort(), [
    'GIT_CONFIG_GLOBAL',
    'GIT_CONFIG_SYSTEM',
    'HOME',
    'PATH',
  ]);
  assert.equal(env.PATH, process.env.PATH);
  assert.equal(env.GIT_CONFIG_GLOBAL, '/dev/null');
  assert.equal(env.GIT_CONFIG_SYSTEM, '/dev/null');
  assert.notEqual(env.HOME, os.homedir());
  assert.notEqual(env.HOME, process.env.HOME);
  assert.ok(existsSync(env.HOME!));
});
