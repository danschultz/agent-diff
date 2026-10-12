import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** What `implement` remembers about a brief it started. GitHub labels hold the rest. */
export interface BriefState {
  issue: number;
  repo: string;
  title: string;
  branch: string;
  worktree: string;
  /** The Remote Control and display name of the agent session. */
  sessionName: string;
  /** Claude Code's session id, used to resume. Found after the agent session starts. */
  sessionId?: string;
  /** When the agent session was last started or resumed, in ms since the epoch. */
  launchedAt: number;
  /** Pull request reviews that have already been handed to the agent session. */
  handledReviewIds: string[];
}

export interface State {
  briefs: Record<string, BriefState>;
}

export interface StateStore {
  load(): State;
  save(state: State): void;
}

export function fileStateStore(stateDir: string): StateStore {
  const file = path.join(stateDir, 'state.json');
  return {
    load() {
      try {
        return JSON.parse(readFileSync(file, 'utf8')) as State;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { briefs: {} };
        throw error;
      }
    },
    save(state) {
      mkdirSync(stateDir, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
      renameSync(tmp, file);
    },
  };
}

/** Finds the brief an agent session belongs to, by session id or by its working directory. */
export function findBrief(state: State, sessionId: string | undefined, cwd: string | undefined): BriefState | undefined {
  const briefs = Object.values(state.briefs);
  return (
    briefs.find((b) => sessionId && b.sessionId === sessionId) ??
    briefs.find((b) => cwd && (cwd === b.worktree || cwd.startsWith(b.worktree + path.sep)))
  );
}

/**
 * Takes an exclusive lock so a manual tick never overlaps the timer's. Returns
 * a release function, or undefined when another live process holds the lock.
 */
export function acquireLock(stateDir: string): (() => void) | undefined {
  mkdirSync(stateDir, { recursive: true });
  const file = path.join(stateDir, 'tick.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(file, 'wx');
      writeFileSync(fd, String(process.pid));
      closeSync(fd);
      return () => rmSync(file, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const pid = Number(readFileSync(file, 'utf8'));
      if (pid && isAlive(pid)) return undefined;
      rmSync(file, { force: true });
    }
  }
  return undefined;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
