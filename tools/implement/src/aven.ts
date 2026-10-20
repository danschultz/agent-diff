// Briefs are tasks in the local Aven database, read and changed through the
// `aven` CLI. See docs/decisions/0034-briefs-are-aven-tasks.md.

import { run } from './exec.ts';

/** The metadata key that holds a brief's state. */
export const AGENT_KEY = 'agent';

/** The values of the `agent` metadata. */
export const AGENT = {
  queued: 'queued',
  working: 'working',
  needsInput: 'needs-input',
  review: 'review',
  failed: 'failed',
} as const;

export type AgentState = (typeof AGENT)[keyof typeof AGENT];

export type TaskStatus =
  'inbox' | 'backlog' | 'todo' | 'active' | 'done' | 'canceled';

export interface Task {
  /** Stable, unlike the ref, whose prefix changes when the task moves project. */
  id: string;
  /** Such as AD-7KQ9. Only ever shown locally, never on GitHub. */
  ref: string;
  title: string;
  description: string;
  status: TaskStatus;
  /** The `agent` metadata, or undefined when it isn't set. Dan can set any value. */
  agent: string | undefined;
}

export interface TaskChanges {
  status?: TaskStatus;
  /** Sets the `agent` metadata, or removes it when null. */
  agent?: AgentState | null;
}

export interface Aven {
  /** Open tasks in the project with `agent=queued`, oldest first. */
  queuedTasks(): Task[];
  task(id: string): Task;
  edit(id: string, changes: TaskChanges): void;
  note(id: string, body: string): void;
}

/** Done or canceled: Dan is finished with it. */
export function isClosed(task: Task): boolean {
  return task.status === 'done' || task.status === 'canceled';
}

interface RawListedTask {
  id: string;
  created_at: string;
}

interface RawTask {
  task: { id: string; ref: string; title: string; status: TaskStatus };
  description: string;
  metadata: Record<string, string>;
}

/** The IDs of the tasks in `aven list --json` output, oldest first. */
export function parseQueuedIds(json: string): string[] {
  return (JSON.parse(json) as RawListedTask[])
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((t) => t.id);
}

/** A task from `aven show --full --json` output. */
export function parseTask(json: string): Task {
  const raw = JSON.parse(json) as RawTask;
  return {
    id: raw.task.id,
    ref: raw.task.ref,
    title: raw.task.title,
    description: raw.description,
    status: raw.task.status,
    agent: raw.metadata[AGENT_KEY],
  };
}

/**
 * Runs `aven` against its default database, or `AVEN_DB` when `env` sets it.
 * Tasks are found by ID, which `aven` accepts as a ref, and queued tasks are
 * listed in `project`, never in one inferred from the current directory. Tests
 * pass an `env` that points `aven` at a scratch database and config.
 */
export function cliAven(
  avenBin: string,
  project: string,
  env: NodeJS.ProcessEnv = process.env,
): Aven {
  const aven = (args: string[], input?: string) =>
    run(avenBin, args, { input, env });
  const task = (id: string) =>
    parseTask(aven(['show', id, '--full', '--json']));
  return {
    queuedTasks() {
      // `list` output has no metadata or description, so each task is read in full.
      return parseQueuedIds(
        aven([
          'list',
          '--project',
          project,
          '--open',
          '--metadata',
          `${AGENT_KEY}=${AGENT.queued}`,
          '--limit',
          '100',
          '--json',
        ]),
      ).map(task);
    },
    task,
    edit(id, { status, agent }) {
      const args = ['edit', id];
      if (status) args.push('--status', status);
      if (agent === null) args.push('--remove-metadata', AGENT_KEY);
      else if (agent) args.push('--metadata', `${AGENT_KEY}=${agent}`);
      if (args.length > 2) aven(args);
    },
    note(id, body) {
      aven(['note', id, '--stdin'], body);
    },
  };
}

/** Moves a task's brief to `state`, if it isn't there already. */
export function moveTo(aven: Aven, task: Task, state: AgentState): void {
  if (task.agent === state) return;
  aven.edit(task.id, { agent: state });
  task.agent = state;
}
