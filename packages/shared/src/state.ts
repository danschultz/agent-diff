// The user's state directory and the files in it, from decision 0024. The
// review server creates them, and the CLI reads the config file to find the
// review server.
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as v from 'valibot';

export interface StatePaths {
  dir: string;
  config: string;
  database: string;
}

// `$XDG_STATE_HOME/agent-diff`, or `~/.local/state/agent-diff` when
// `XDG_STATE_HOME` isn't set. The XDG spec says a relative value is invalid
// and should be ignored, so it is.
export function statePaths(env: NodeJS.ProcessEnv = process.env): StatePaths {
  const base =
    env.XDG_STATE_HOME && path.isAbsolute(env.XDG_STATE_HOME)
      ? env.XDG_STATE_HOME
      : path.join(os.homedir(), '.local', 'state');
  const dir = path.join(base, 'agent-diff');
  return {
    dir,
    config: path.join(dir, 'config.json'),
    database: path.join(dir, 'agent-diff.db'),
  };
}

export const Config = v.object({
  port: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65535)),
});

export type Config = v.InferOutput<typeof Config>;

// The saved config, or undefined when the file doesn't exist or isn't a valid
// config, as before the first `server start`.
export function readConfig(paths: StatePaths): Config | undefined {
  let text: string;
  try {
    text = readFileSync(paths.config, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  const result = v.safeParse(Config, json);
  return result.success ? result.output : undefined;
}

export function serverUrl(port: number): string {
  return `http://127.0.0.1:${port}/`;
}
