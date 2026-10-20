import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { avenConfig } from '../src/config.ts';

test('IMPLEMENT_AVEN and IMPLEMENT_AVEN_PROJECT set the aven binary and project', () => {
  assert.deepEqual(
    avenConfig({
      IMPLEMENT_AVEN: '/opt/aven',
      IMPLEMENT_AVEN_PROJECT: 'other',
    }),
    { avenBin: '/opt/aven', avenProject: 'other' },
  );
});

test('aven defaults to ~/.local/bin/aven when it exists, and the project to agent-diff', () => {
  const local = path.join(os.homedir(), '.local', 'bin', 'aven');
  assert.deepEqual(avenConfig({}), {
    avenBin: existsSync(local) ? local : 'aven',
    avenProject: 'agent-diff',
  });
});
