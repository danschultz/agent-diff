// Delivers notifications (0005). Only the one-line message is sent, never the
// comments themselves.
//
// Notify methods, as registered by an agent or its harness:
//   tmux:<target>     types the message into a tmux pane, then presses Enter
//   cmux:<surface>    pastes and submits through `cmux paste --submit`
//   command:<shell>   runs a shell command with the message in $AGENT_DIFF_MESSAGE
//   hook              nothing is pushed; the agent's hooks pick it up at the next turn boundary
//   none              nothing is pushed; the review UI shows the message to paste

import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type DeliveryKind = 'push' | 'pull' | 'manual';

export function deliveryKind(method: string): DeliveryKind {
  if (method.startsWith('tmux:') || method.startsWith('cmux:') || method.startsWith('command:')) return 'push';
  if (method === 'hook') return 'pull';
  return 'manual';
}

export function validateNotifyMethod(method: string): string | null {
  if (method === 'hook' || method === 'none') return null;
  for (const prefix of ['tmux:', 'cmux:', 'command:']) {
    if (method.startsWith(prefix)) return method.length > prefix.length ? null : `${prefix} needs a target`;
  }
  return `Unknown notify method "${method}". Use tmux:<target>, cmux:<surface>, command:<shell>, hook, or none.`;
}

export async function push(method: string, message: string, enterDelayMs: number): Promise<void> {
  if (method.startsWith('tmux:')) {
    const target = method.slice('tmux:'.length);
    await execFileAsync('tmux', ['send-keys', '-t', target, '-l', message]);
    await sleep(enterDelayMs);
    await execFileAsync('tmux', ['send-keys', '-t', target, 'Enter']);
    return;
  }
  if (method.startsWith('cmux:')) {
    const surface = method.slice('cmux:'.length);
    // `paste --submit` refuses to send over a prompt someone is typing in or an
    // open dialog, which tmux can't detect. The failure shows up as a resendable notification.
    try {
      await execFileAsync(cmuxBinary(), ['paste', '--surface', surface, '--submit', '--', message]);
    } catch (error) {
      const stderr = (error as { stderr?: string }).stderr?.trim();
      throw new Error(stderr || (error as Error).message);
    }
    return;
  }
  if (method.startsWith('command:')) {
    const command = method.slice('command:'.length);
    await new Promise<void>((resolve, reject) => {
      const child = spawn('/bin/sh', ['-c', command], {
        env: { ...process.env, AGENT_DIFF_MESSAGE: message },
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`exited ${code}: ${stderr.trim()}`))));
    });
    return;
  }
  throw new Error(`${method} can't push notifications`);
}

/** The review server may have been started outside cmux, where its CLI isn't on PATH. */
function cmuxBinary(): string {
  if (process.env.AGENT_DIFF_CMUX) return process.env.AGENT_DIFF_CMUX;
  const bundled = '/Applications/cmux.app/Contents/Resources/bin/cmux';
  const onPath = (process.env.PATH ?? '').split(':').some((dir) => dir && existsSync(`${dir}/cmux`));
  return onPath || !existsSync(bundled) ? 'cmux' : bundled;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
