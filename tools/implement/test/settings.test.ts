import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { writeSettingsFile } from '../src/settings.ts';

test('the hooks are told where the state is and which aven to run', (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'implement-settings-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = writeSettingsFile(dir, '/opt/aven bin/aven');
  const settings = JSON.parse(readFileSync(file, 'utf8')) as {
    hooks: Record<string, { hooks: { command: string }[] }[]>;
  };
  const command = settings.hooks.Notification[0].hooks[0].command;
  assert.match(command, new RegExp(`^IMPLEMENT_STATE_DIR=${dir} `));
  assert.match(command, / IMPLEMENT_AVEN='\/opt\/aven bin\/aven' /);
  assert.match(command, / hook notification$/);
});
