// Creates the user's state directory and writes the config file, with the
// modes from decision 0024.
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Config, StatePaths } from '@agent-diff/shared/state';

// Creates the state directory, readable only by the user. Its parents, such as
// `~/.local/state`, are created with the default mode.
export function ensureStateDir(paths: StatePaths): void {
  mkdirSync(path.dirname(paths.dir), { recursive: true });
  try {
    mkdirSync(paths.dir, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return;
    throw error;
  }
  // The mode passed to mkdir is reduced by the umask.
  chmodSync(paths.dir, 0o700);
}

// Writes the config file, readable and writable only by the user.
export function writeConfig(paths: StatePaths, config: Config): void {
  writeFileSync(paths.config, JSON.stringify(config, null, 2) + '\n', {
    mode: 0o600,
  });
  // The mode passed to writeFileSync only applies when the file is created,
  // and is reduced by the umask.
  chmodSync(paths.config, 0o600);
}
