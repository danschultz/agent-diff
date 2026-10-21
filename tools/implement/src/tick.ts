// One tick: reap, resume, start, prune. Run every 2 minutes by the systemd timer.

import path from 'node:path';
import {
  AGENT,
  AGENT_KEY,
  isClosed,
  moveTo,
  type Aven,
  type Blocker,
  type Task,
  type TaskChanges,
} from './aven.ts';
import { missingFields, slugify } from './brief.ts';
import { isWorking, type AgentSessionInfo, type Claude } from './claude.ts';
import type { Config } from './config.ts';
import type { Git } from './git.ts';
import type { GitHub, PullRequest, Review } from './github.ts';
import { resumePrompt, startPrompt } from './prompts.ts';
import type { BriefState, State } from './state.ts';

/** How long a just-launched agent session may be missing from `claude agents` before it counts as exited. */
export const LAUNCH_GRACE_MS = 3 * 60 * 1000;

export interface Deps {
  config: Config;
  aven: Aven;
  github: GitHub;
  git: Git;
  claude: Claude;
  state: State;
  /** The settings file with implement's hooks, passed to new agent sessions. */
  settingsFile: string;
  /** Keeps branch names unique without deriving them from the task. */
  randomSuffix: () => string;
  now: () => number;
  sleep: (ms: number) => void;
  log: (message: string) => void;
}

interface Tracked {
  brief: BriefState;
  task: Task;
  pr: PullRequest | undefined;
  session: AgentSessionInfo | undefined;
  /** Uses a concurrency slot: running, or launched too recently to show up yet. */
  occupiesSlot: boolean;
  /** Stopped this tick. Resuming waits for the next tick, so the stop has finished by then. */
  stopped?: boolean;
}

export function tick(deps: Deps): void {
  const running = deps.claude.running();
  const tracked: Tracked[] = [];
  for (const brief of Object.values(deps.state.briefs)) {
    const result = guard(deps, brief.ref, () => reap(deps, brief, running));
    if (result) tracked.push(result);
  }
  let slots =
    deps.config.concurrency - tracked.filter((t) => t.occupiesSlot).length;
  for (const t of tracked) {
    if (slots <= 0) break;
    if (guard(deps, t.brief.ref, () => resume(deps, t))) slots--;
  }
  startQueued(deps, slots, running);
  deps.git.prune();
}

/** Runs one brief's step, so a failure on one brief doesn't stop the others. */
function guard<T>(deps: Deps, ref: string, step: () => T): T | undefined {
  try {
    return step();
  } catch (error) {
    deps.log(`${ref}: ${(error as Error).message}`);
    return undefined;
  }
}

function findSession(
  running: AgentSessionInfo[],
  brief: BriefState,
): AgentSessionInfo | undefined {
  return brief.sessionId
    ? running.find((s) => s.sessionId === brief.sessionId)
    : running.find((s) => s.cwd === brief.worktree);
}

/** Why a brief should be let go, or undefined while `implement` keeps it. */
function letGoReason(
  task: Task,
  pr: PullRequest | undefined,
): string | undefined {
  if (pr?.state === 'MERGED') return `pull request #${pr.number} merged`;
  if (pr?.state === 'CLOSED')
    return `pull request #${pr.number} closed without merging`;
  if (isClosed(task)) return `task ${task.status}`;
  if (task.agent === undefined) return 'agent metadata removed';
  return undefined;
}

/**
 * Brings one started brief up to date: lets finished ones go, reports agent
 * sessions that exited without a pull request, and stops agent sessions whose
 * brief is in review. Returns undefined once the brief is no longer tracked.
 */
function reap(
  deps: Deps,
  brief: BriefState,
  running: AgentSessionInfo[],
): Tracked | undefined {
  const { aven, github, claude } = deps;
  const task = aven.task(brief.taskId);
  brief.ref = task.ref;
  const pr = github.pullRequestForBranch(brief.branch);
  const session = findSession(running, brief);
  if (session && !brief.sessionId) brief.sessionId = session.sessionId;

  if (pr && brief.pullRequestUrl !== pr.url) {
    aven.note(task.id, `Pull request: ${pr.url}`);
    brief.pullRequestUrl = pr.url;
  }

  const reason = letGoReason(task, pr);
  if (reason) {
    letGo(deps, brief, task, session, pr?.state === 'MERGED');
    deps.log(`${task.ref}: ${reason}, let go and removed ${brief.worktree}`);
    return undefined;
  }

  const launchedRecently = deps.now() - brief.launchedAt < LAUNCH_GRACE_MS;

  if (!session) {
    if (launchedRecently)
      return { brief, task, pr, session, occupiesSlot: true };
    if (task.agent === AGENT.working || task.agent === AGENT.needsInput) {
      if (pr) {
        moveTo(aven, task, AGENT.review);
        aven.note(
          task.id,
          `The agent session exited while working, after opening pull request #${pr.number}: ${pr.url}. Moved to \`agent=${AGENT.review}\`.`,
        );
        deps.log(`${task.ref}: agent session exited, moved to review`);
      } else {
        const tail = claude.logTail(brief.sessionName, brief.sessionId);
        moveTo(aven, task, AGENT.failed);
        aven.note(
          task.id,
          `The agent session exited without opening a pull request. The worktree \`${brief.worktree}\` is kept until the brief is let go or queued again.\n\nEnd of the agent session's output:\n\n\`\`\`\`\n${tail}\n\`\`\`\``,
        );
        deps.log(
          `${task.ref}: agent session exited without a pull request, marked failed`,
        );
      }
    }
    return { brief, task, pr, session, occupiesSlot: false };
  }

  if (task.agent === AGENT.review && !isWorking(session)) {
    claude.stop(session.id);
    deps.log(
      `${task.ref}: in review, stopped agent session ${brief.sessionName}`,
    );
    return {
      brief,
      task,
      pr,
      session: undefined,
      occupiesSlot: false,
      stopped: true,
    };
  }
  if (task.agent === AGENT.needsInput && isWorking(session)) {
    // Dan answered through Remote Control and the agent session is working again.
    moveTo(aven, task, AGENT.working);
  }
  return { brief, task, pr, session, occupiesSlot: true };
}

/**
 * Stops tracking a brief: stops its agent session, removes its worktree and
 * local branch, and removes the `agent` metadata. A merged brief's task is set
 * to done. An open brief Dan has queued again keeps `agent=queued`, so it
 * starts over.
 */
function letGo(
  deps: Deps,
  brief: BriefState,
  task: Task,
  session: AgentSessionInfo | undefined,
  merged: boolean,
): void {
  if (session) deps.claude.stop(session.id);
  deps.git.removeWorktree(brief.worktree, brief.branch);
  const changes: TaskChanges = {};
  if (merged) changes.status = 'done';
  const queuedAgain = task.agent === AGENT.queued && !isClosed(task);
  if (task.agent !== undefined && (merged || !queuedAgain))
    changes.agent = null;
  if (Object.keys(changes).length > 0) deps.aven.edit(task.id, changes);
  delete deps.state.briefs[brief.taskId];
}

/** Reviews from Dan that haven't been handed to the agent session yet. */
export function newReviews(
  reviews: Review[],
  author: string,
  handled: string[],
): Review[] {
  // A pull request opened from Dan's account can't get a "changes requested"
  // review from Dan, since GitHub doesn't let authors request changes on their
  // own pull requests, so Dan's comment reviews count too.
  return reviews.filter(
    (r) =>
      r.author === author &&
      !handled.includes(r.id) &&
      (r.state === 'CHANGES_REQUESTED' || r.state === 'COMMENTED'),
  );
}

/** Resumes a stopped agent session when its pull request has new reviews. Returns whether it resumed. */
function resume(deps: Deps, t: Tracked): boolean {
  const { brief, task, pr, session } = t;
  if (
    session ||
    t.occupiesSlot ||
    t.stopped ||
    !pr ||
    pr.state !== 'OPEN' ||
    task.agent !== AGENT.review
  )
    return false;
  const reviews = newReviews(
    pr.reviews,
    deps.config.author,
    brief.handledReviewIds,
  );
  if (reviews.length === 0) return false;
  if (!brief.sessionId)
    throw new Error('has new reviews but no session id to resume');
  moveTo(deps.aven, task, AGENT.working);
  deps.claude.resume(
    brief.worktree,
    brief.sessionId,
    resumePrompt(brief, pr, reviews),
  );
  brief.handledReviewIds.push(...reviews.map((r) => r.id));
  brief.launchedAt = deps.now();
  deps.log(
    `${task.ref}: resumed ${brief.sessionName} for ${reviews.length} review(s) on #${pr.number}`,
  );
  return true;
}

/** Why a queued brief can't start yet. */
type Hold =
  /** Missing required fields: sent back. */
  | { kind: 'missing'; fields: string[] }
  /** Depends on tasks that are canceled or deleted, so they'll never be done: sent back. */
  | { kind: 'abandoned'; blockers: Blocker[] }
  /** Depends on tasks that aren't done yet: left queued. */
  | { kind: 'waiting'; blockers: Blocker[] };

/**
 * Why a queued brief can't start yet, or undefined when it can. Only `done`
 * unblocks a brief, unlike Aven, which counts canceled and deleted blockers as
 * resolved.
 */
function hold(task: Task): Hold | undefined {
  const missing = missingFields(task.description);
  if (missing.length > 0) return { kind: 'missing', fields: missing };
  const abandoned = task.blockers.filter(
    (b) => b.deleted || b.status === 'canceled',
  );
  if (abandoned.length > 0) return { kind: 'abandoned', blockers: abandoned };
  const open = task.blockers.filter((b) => b.status !== 'done');
  if (open.length > 0) return { kind: 'waiting', blockers: open };
  return undefined;
}

/** The queued briefs a tick leaves waiting on blockers, each with the blockers that aren't done. */
export function waitingBriefs(
  tasks: Task[],
): { task: Task; blockers: Blocker[] }[] {
  return tasks.flatMap((task) => {
    const h = hold(task);
    return h?.kind === 'waiting' ? [{ task, blockers: h.blockers }] : [];
  });
}

/** Starts agent sessions for queued briefs, up to `slots`. Returns how many it started. */
function startQueued(
  deps: Deps,
  slots: number,
  running: AgentSessionInfo[],
): number {
  let started = 0;
  for (const task of deps.aven.queuedTasks()) {
    const h = hold(task);
    if (h?.kind === 'missing') {
      guard(deps, task.ref, () => sendBack(deps, task, h.fields));
      continue;
    }
    if (h?.kind === 'abandoned') {
      guard(deps, task.ref, () => sendBackForBlockers(deps, task, h.blockers));
      continue;
    }
    if (h?.kind === 'waiting') {
      deps.log(`${task.ref}: waiting on ${refs(h.blockers)}`);
      continue;
    }
    if (started >= slots) break;
    const previous = deps.state.briefs[task.id];
    if (previous && findSession(running, previous)) {
      deps.log(
        `${task.ref}: queued again while its agent session is running; waiting for it to exit`,
      );
      continue;
    }
    guard(deps, task.ref, () => {
      if (previous) {
        // Queued again after failing: start over from a fresh worktree.
        deps.git.removeWorktree(previous.worktree, previous.branch);
        delete deps.state.briefs[task.id];
        deps.log(
          `${task.ref}: queued again, removed the previous worktree ${previous.worktree}`,
        );
      }
      start(deps, task);
    });
    started++;
  }
  return started;
}

/** Removes `agent=queued` from a brief missing required fields, with a note saying which. */
function sendBack(deps: Deps, task: Task, missing: string[]): void {
  deps.aven.edit(task.id, { agent: null });
  deps.aven.note(
    task.id,
    `This brief is missing required fields, so it won't be started:\n\n${missing.map((m) => `- ${m}`).join('\n')}\n\nFill them in under \`###\` headings, as in \`.rules/briefs.md\`, then set \`${AGENT_KEY}=${AGENT.queued}\` again.`,
  );
  deps.log(`${task.ref}: missing ${missing.join(', ')}, sent back`);
}

/**
 * Removes `agent=queued` from a brief that depends on canceled or deleted
 * tasks, with a note naming them and saying how to remove each dependency.
 */
function sendBackForBlockers(
  deps: Deps,
  task: Task,
  blockers: Blocker[],
): void {
  deps.aven.edit(task.id, { agent: null });
  const list = blockers
    .map(
      (b) =>
        `- ${b.ref} ${b.title} (${b.deleted ? 'deleted' : b.status}): \`aven dep remove ${task.ref} ${b.ref}\``,
    )
    .join('\n');
  deps.aven.note(
    task.id,
    `This brief depends on tasks that are canceled or deleted, so they'll never be done, and it won't be started:\n\n${list}\n\nRemove each dependency with the command after it, then set \`${AGENT_KEY}=${AGENT.queued}\` again.`,
  );
  deps.log(
    `${task.ref}: depends on canceled or deleted ${refs(blockers)}, sent back`,
  );
}

function refs(blockers: Blocker[]): string {
  return blockers.map((b) => b.ref).join(', ');
}

function start(deps: Deps, task: Task): void {
  const { config, aven, claude } = deps;
  // Nothing in the name comes from the task's ref or ID, since branch names
  // end up on GitHub.
  const name = `${slugify(task.title)}-${deps.randomSuffix()}`;
  const brief: BriefState = {
    taskId: task.id,
    ref: task.ref,
    repo: config.repo,
    title: task.title,
    branch: `brief/${name}`,
    worktree: path.join(config.worktreesDir, `brief-${name}`),
    sessionName: `brief-${name}`,
    launchedAt: deps.now(),
    handledReviewIds: [],
  };
  aven.edit(task.id, { status: 'active', agent: AGENT.working });
  task.status = 'active';
  task.agent = AGENT.working;
  try {
    deps.git.addWorktree(brief.worktree, brief.branch, config.baseBranch);
    deps.state.briefs[task.id] = brief;
    claude.start({
      cwd: brief.worktree,
      name: brief.sessionName,
      settingsFile: deps.settingsFile,
      prompt: startPrompt(brief, task, config.baseBranch),
    });
    brief.launchedAt = deps.now();
  } catch (error) {
    moveTo(aven, task, AGENT.failed);
    aven.note(
      task.id,
      `Couldn't start an agent session for this brief:\n\n\`\`\`\n${(error as Error).message}\n\`\`\``,
    );
    throw error;
  }
  deps.log(`${task.ref}: started ${brief.sessionName} in ${brief.worktree}`);
  brief.sessionId = waitForSessionId(deps, brief.worktree);
}

/** `claude --bg` returns before the agent session is listed, so poll briefly for its id. */
function waitForSessionId(deps: Deps, worktree: string): string | undefined {
  for (let attempt = 0; attempt < 15; attempt++) {
    const session = deps.claude.running().find((s) => s.cwd === worktree);
    if (session) return session.sessionId;
    deps.sleep(2000);
  }
  deps.log(
    `${worktree}: agent session not listed yet; its id will be looked up next tick`,
  );
  return undefined;
}
