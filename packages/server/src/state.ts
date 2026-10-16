// Creates the user's state directory and writes the config file, with the
// modes from decision 0024.
import {
  chmodSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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

// Writes the config file, readable and writable only by the user. It holds
// the token, so it's written to a new file and renamed over the old one,
// rather than written into an old file that others might be able to read.
export function writeConfig(paths: StatePaths, config: Config): void {
  const temporary = `${paths.config}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(config, null, 2) + '\n', {
      mode: 0o600,
      flag: 'wx',
    });
    // The mode passed to writeFileSync is reduced by the umask.
    chmodSync(temporary, 0o600);
    renameSync(temporary, paths.config);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}
