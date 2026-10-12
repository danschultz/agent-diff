// One tick: reap, resume, start, prune. Run every 2 minutes by the systemd timer.

import path from 'node:path';
import { missingFields, slugify } from './brief.ts';
import type { AgentSessionInfo, Claude } from './claude.ts';
import { LABELS, type Config } from './config.ts';
import type { Git } from './git.ts';
import { moveTo, type GitHub, type Issue, type PullRequest, type Review } from './github.ts';
import { resumePrompt, startPrompt } from './prompts.ts';
import type { BriefState, State } from './state.ts';

const ALL_LABELS = Object.values(LABELS);

/** How long a just-launched agent session may be missing from `claude agents` before it counts as exited. */
export const LAUNCH_GRACE_MS = 3 * 60 * 1000;

export interface Deps {
  config: Config;
  github: GitHub;
  git: Git;
  claude: Claude;
  state: State;
  /** The settings file with implement's hooks, passed to new agent sessions. */
  settingsFile: string;
  now: () => number;
  sleep: (ms: number) => void;
  log: (message: string) => void;
}

interface Tracked {
  brief: BriefState;
  issue: Issue;
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
    const result = guard(deps, brief.issue, () => reap(deps, brief, running));
    if (result) tracked.push(result);
  }
  let slots = deps.config.concurrency - tracked.filter((t) => t.occupiesSlot).length;
  for (const t of tracked) {
    if (slots <= 0) break;
    if (guard(deps, t.brief.issue, () => resume(deps, t))) slots--;
  }
  startQueued(deps, slots, running);
  deps.git.prune();
}

/** Runs one brief's step, so a failure on one brief doesn't stop the others. */
function guard<T>(deps: Deps, issue: number, step: () => T): T | undefined {
  try {
    return step();
  } catch (error) {
    deps.log(`#${issue}: ${(error as Error).message}`);
    return undefined;
  }
}

function findSession(running: AgentSessionInfo[], brief: BriefState): AgentSessionInfo | undefined {
  return brief.sessionId
    ? running.find((s) => s.sessionId === brief.sessionId)
    : running.find((s) => s.cwd === brief.worktree);
}

/**
 * Brings one started brief up to date: cleans up finished ones, reports agent
 * sessions that exited without a pull request, and stops agent sessions whose
 * brief is in review. Returns undefined once the brief is no longer tracked.
 */
function reap(deps: Deps, brief: BriefState, running: AgentSessionInfo[]): Tracked | undefined {
  const { github, claude, state } = deps;
  const issue = github.issue(brief.issue);
  const pr = github.pullRequestForBranch(brief.branch);
  const session = findSession(running, brief);
  if (session && !brief.sessionId) brief.sessionId = session.sessionId;

  // Finished: the pull request is merged or closed, or the issue was closed
  // without one (a failed brief Dan is done with, or a brief Dan called off).
  if ((pr && pr.state !== 'OPEN') || (!pr && issue.state === 'CLOSED')) {
    if (session) claude.stop(brief.sessionName);
    deps.git.removeWorktree(brief.worktree, brief.branch);
    delete state.briefs[brief.issue];
    deps.log(`#${brief.issue}: ${pr ? `pull request #${pr.number} ${pr.state.toLowerCase()}` : 'issue closed'}, removed ${brief.worktree}`);
    return undefined;
  }

  const has = (label: string) => issue.labels.includes(label);
  const launchedRecently = deps.now() - brief.launchedAt < LAUNCH_GRACE_MS;

  if (!session) {
    if (launchedRecently) return { brief, issue, pr, session, occupiesSlot: true };
    if (has(LABELS.working) || has(LABELS.needsInput)) {
      if (pr) {
        moveTo(github, issue, LABELS.review, ALL_LABELS);
        github.comment(issue.number, `The agent session exited while working, after opening #${pr.number}. Moved to \`${LABELS.review}\`.`);
        deps.log(`#${brief.issue}: agent session exited, moved to review`);
      } else {
        const tail = claude.logTail(brief.sessionName, brief.sessionId);
        moveTo(github, issue, LABELS.failed, ALL_LABELS);
        github.comment(
          issue.number,
          `The agent session exited without opening a pull request. The worktree \`${brief.worktree}\` is kept until this issue is closed.\n\nEnd of the agent session's output:\n\n\`\`\`\`\n${tail}\n\`\`\`\``,
        );
        deps.log(`#${brief.issue}: agent session exited without a pull request, marked failed`);
      }
    }
    return { brief, issue, pr, session, occupiesSlot: false };
  }

  if (has(LABELS.review) && session.status !== 'busy') {
    claude.stop(brief.sessionName);
    deps.log(`#${brief.issue}: in review, stopped agent session ${brief.sessionName}`);
    return { brief, issue, pr, session: undefined, occupiesSlot: false, stopped: true };
  }
  if (has(LABELS.needsInput) && session.status === 'busy') {
    // Dan answered through Remote Control and the agent session is working again.
    moveTo(github, issue, LABELS.working, ALL_LABELS);
  }
  return { brief, issue, pr, session, occupiesSlot: true };
}

/** Reviews from Dan that haven't been handed to the agent session yet. */
export function newReviews(reviews: Review[], author: string, handled: string[]): Review[] {
  // A pull request opened from Dan's account can't get a "changes requested"
  // review from Dan, since GitHub doesn't let authors request changes on their
  // own pull requests, so Dan's comment reviews count too.
  return reviews.filter(
    (r) => r.author === author && !handled.includes(r.id) && (r.state === 'CHANGES_REQUESTED' || r.state === 'COMMENTED'),
  );
}

/** Resumes a stopped agent session when its pull request has new reviews. Returns whether it resumed. */
function resume(deps: Deps, t: Tracked): boolean {
  const { brief, issue, pr, session } = t;
  if (session || t.occupiesSlot || t.stopped || !pr || pr.state !== 'OPEN' || !issue.labels.includes(LABELS.review)) return false;
  const reviews = newReviews(pr.reviews, deps.config.author, brief.handledReviewIds);
  if (reviews.length === 0) return false;
  if (!brief.sessionId) throw new Error('has new reviews but no session id to resume');
  moveTo(deps.github, issue, LABELS.working, ALL_LABELS);
  deps.claude.resume(brief.worktree, brief.sessionId, resumePrompt(brief, pr, reviews));
  brief.handledReviewIds.push(...reviews.map((r) => r.id));
  brief.launchedAt = deps.now();
  deps.log(`#${brief.issue}: resumed ${brief.sessionName} for ${reviews.length} review(s) on #${pr.number}`);
  return true;
}

/** Starts agent sessions for queued briefs, up to `slots`. Returns how many it started. */
function startQueued(deps: Deps, slots: number, running: AgentSessionInfo[]): number {
  const { config, github } = deps;
  let started = 0;
  for (const issue of github.queuedIssues(LABELS.queued)) {
    if (issue.author !== config.author) {
      github.setLabels(issue.number, [], [LABELS.queued]);
      github.comment(issue.number, `Only briefs written by @${config.author} are accepted, so this one won't be started.`);
      deps.log(`#${issue.number}: written by @${issue.author}, not accepted`);
      continue;
    }
    const missing = missingFields(issue.body);
    if (missing.length > 0) {
      github.setLabels(issue.number, [], [LABELS.queued]);
      github.comment(
        issue.number,
        `This brief is missing required fields, so it won't be started:\n\n${missing.map((m) => `- ${m}`).join('\n')}\n\nFill them in using the brief template's headings, then add \`${LABELS.queued}\` again.`,
      );
      deps.log(`#${issue.number}: missing ${missing.join(', ')}, sent back`);
      continue;
    }
    if (started >= slots) break;
    const previous = deps.state.briefs[issue.number];
    if (previous && findSession(running, previous)) {
      deps.log(`#${issue.number}: queued again while its agent session is running; waiting for it to exit`);
      continue;
    }
    guard(deps, issue.number, () => {
      if (previous) {
        // Queued again after failing: start over from a fresh worktree.
        deps.git.removeWorktree(previous.worktree, previous.branch);
        delete deps.state.briefs[issue.number];
        deps.log(`#${issue.number}: queued again, removed the previous worktree ${previous.worktree}`);
      }
      start(deps, issue);
    });
    started++;
  }
  return started;
}

function start(deps: Deps, issue: Issue): void {
  const { config, github, claude } = deps;
  const slug = slugify(issue.title);
  const brief: BriefState = {
    issue: issue.number,
    repo: config.repo,
    title: issue.title,
    branch: `brief/${issue.number}-${slug}`,
    worktree: path.join(config.worktreesDir, `brief-${issue.number}-${slug}`),
    sessionName: `brief-${issue.number}-${slug}`,
    launchedAt: deps.now(),
    handledReviewIds: [],
  };
  moveTo(github, issue, LABELS.working, ALL_LABELS);
  try {
    deps.git.addWorktree(brief.worktree, brief.branch, config.baseBranch);
    deps.state.briefs[issue.number] = brief;
    claude.start({ cwd: brief.worktree, name: brief.sessionName, settingsFile: deps.settingsFile, prompt: startPrompt(brief, issue, config.baseBranch) });
    brief.launchedAt = deps.now();
  } catch (error) {
    moveTo(github, issue, LABELS.failed, ALL_LABELS);
    github.comment(issue.number, `Couldn't start an agent session for this brief:\n\n\`\`\`\n${(error as Error).message}\n\`\`\``);
    throw error;
  }
  deps.log(`#${issue.number}: started ${brief.sessionName} in ${brief.worktree}`);
  brief.sessionId = waitForSessionId(deps, brief.worktree);
}

/** `claude --bg` returns before the agent session is listed, so poll briefly for its id. */
function waitForSessionId(deps: Deps, worktree: string): string | undefined {
  for (let attempt = 0; attempt < 15; attempt++) {
    const session = deps.claude.running().find((s) => s.cwd === worktree);
    if (session) return session.sessionId;
    deps.sleep(2000);
  }
  deps.log(`${worktree}: agent session not listed yet; its id will be looked up next tick`);
  return undefined;
}
