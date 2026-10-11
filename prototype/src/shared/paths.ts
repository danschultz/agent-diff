import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const prototypeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** All prototype state lives here, inside the project, unless overridden. */
export const dataDir = path.resolve(process.env.AGENT_DIFF_DATA_DIR ?? path.join(prototypeDir, '.data'));

export const defaultPort = Number(process.env.AGENT_DIFF_PORT ?? 4317);

export const serverInfoFile = path.join(dataDir, 'server.json');

export const serverLogFile = path.join(dataDir, 'server.log');

/** The command agents are told to run. Absolute, so it works without a PATH change. */
export const cliCommand = process.env.AGENT_DIFF_CLI ?? path.join(prototypeDir, 'bin', 'agent-diff');

export interface ServerInfo {
  pid: number;
  port: number;
  url: string;
  startedAt: string;
}
