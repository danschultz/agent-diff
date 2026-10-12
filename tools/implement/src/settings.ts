import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { mainScript, toolDir } from './config.ts';

/**
 * Writes tools/implement/settings.json to the state directory with the hook
 * command filled in, and returns its path. Agent sessions get it through
 * --settings, so the hooks run only in agent sessions implement started.
 */
export function writeSettingsFile(stateDir: string): string {
  const template = readFileSync(path.join(toolDir, 'settings.json'), 'utf8');
  // The hook runs in the agent session's environment, so it's told where the state is.
  const command = `IMPLEMENT_STATE_DIR=${shellQuote(stateDir)} ${shellQuote(process.execPath)} ${shellQuote(mainScript)}`;
  const file = path.join(stateDir, 'settings.json');
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(file, template.replaceAll('{{implement}}', JSON.stringify(command).slice(1, -1)));
  return file;
}

function shellQuote(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}
