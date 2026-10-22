// The prompts `implement` gives agent sessions.

import { AGENT, AGENT_KEY, type Task } from './aven.ts';
import type { PullRequest, Review } from './github.ts';
import type { BriefState } from './state.ts';

const ESCALATION = `## When to stop and ask Dan

Stop and ask Dan instead of deciding alone when any of these is true:

- An escalation criterion in the brief applies.
- The work would cross the brief's out of scope boundary.
- The acceptance criteria can't all be met.
- Auto mode won't allow an action you need.

To ask: send Dan a push notification with a one-line summary, then end your
turn with the question as your last message. Don't guess and carry on. Dan
answers through Remote Control, and \`implement\` adds your question to the
brief as a note for you.`;

const GITHUB_ETIQUETTE = `## GitHub

You act on GitHub as Dan's account. Never submit pull request reviews or reply
in review threads, since those look like Dan reviewing. To say something on
the pull request, use \`gh pr comment\`.`;

/** How the agent session reads the brief, and what it keeps out of GitHub and git. */
function avenSection(ref: string): string {
  return `## The brief in Aven

The brief is the task ${ref} in Aven, Dan's local task manager. Read it, with
its latest notes, with \`aven context ${ref}\`. Change it in Aven only as these
instructions say.

${ref} is local to this server. Keep ${ref}, and anything else that identifies
the brief, such as the task's ID, out of branch names, commits, and pull
requests.`;
}

/** The tasks the brief depends on, all done by the time it starts, or nothing when it has none. */
function blockersSection(task: Task): string {
  if (task.blockers.length === 0) return '';
  const list = task.blockers.map((b) => `- ${b.ref}: ${b.title}`).join('\n');
  return `

## Tasks this brief depends on

The brief depends on these tasks in Aven, which are all done:

${list}

Read any of them with \`aven context <ref>\` if it helps, but don't change them.
They're local to this server too. Keep their refs, and their IDs, out of branch
names, commits, and pull requests.`;
}

/** The command that moves the brief to review. */
function toReview(ref: string): string {
  return `aven edit ${ref} --metadata ${AGENT_KEY}=${AGENT.review}`;
}

export function startPrompt(
  brief: BriefState,
  task: Task,
  baseBranch: string,
): string {
  return `You're implementing brief ${task.ref} in ${brief.repo}, unattended on a headless server. Nobody is watching this terminal.

# Brief ${task.ref}: ${task.title}

${task.description.trim()}

# How to work

- You're in a git worktree on the branch \`${brief.branch}\`, created from
  \`origin/${baseBranch}\`.
- Read AGENTS.md first and follow it. This brief is an agreed task, so you can
  implement it without asking for agreement first.
- The goal is the outcome to deliver. Out of scope is a hard boundary.
- Explore before editing: read the brief's Context and the files the change
  touches. Before starting a brief with more than one step, write a short plan.
- Match the surrounding code, keep the diff to the brief, and leave unrelated
  code alone.
- Commit as you go.

${avenSection(task.ref)}${blockersSection(task)}

${ESCALATION}

## When you're done

1. Check each acceptance criterion, and run every verification step,
   recording the results.
2. Self-review, before pushing. Commit everything, so the diff range holds all
   of it. Then start the \`self-review\` sub-agent with the Agent tool, and
   give it only the brief's ref, ${task.ref}, and the diff range
   \`origin/${baseBranch}...HEAD\`: not your summary or reasoning. Fix the
   findings you agree with, test-first, and rerun the verification steps.
   If the fixes were substantial, start a second, new \`self-review\` sub-agent,
   and give it the first round's findings and how you handled each, as well.
   Run at most 2 rounds.
3. Push the branch: \`git push -u origin ${brief.branch}\`.
4. Open a draft pull request against \`${baseBranch}\` with
   \`gh pr create --draft\`. Its body has no "Closes" line, and must contain:
   - The acceptance criteria as a checklist, each checked if met, or left
     unchecked with the reason it's not met.
   - The verification results.
   - A "Self-review" section listing every finding as fixed, declined with the
     reason, or still open. Findings still open don't block the pull request.
5. Wait for the pull request's checks with \`gh pr checks <number> --watch\`.
   If no checks are reported yet, wait a few seconds and run it again. If any
   fail, fix them, push again, and watch again. If you can't make them pass,
   stop and ask Dan.
6. Move the brief to review only once they pass:
   \`${toReview(task.ref)}\`.

${GITHUB_ETIQUETTE}
`;
}

export function resumePrompt(
  brief: BriefState,
  pr: PullRequest,
  reviews: Review[],
): string {
  const summaries = reviews
    .map(
      (r) =>
        `- Review ${r.id} by @${r.author} (${r.state}, ${r.submittedAt})${r.body.trim() ? `:\n\n${indent(r.body.trim())}` : ''}`,
    )
    .join('\n');
  return `Dan reviewed pull request #${pr.number} (${pr.url}) for brief ${brief.ref}.

${summaries}

Read the review's inline comments with
\`gh api repos/${brief.repo}/pulls/${pr.number}/comments\` and the conversation with
\`gh pr view ${pr.number} --comments\`.

Address the feedback, rerun the brief's verification steps, update the pull
request body's checklist and verification results, and push. Then wait for the
pull request's checks with \`gh pr checks ${pr.number} --watch\`. If no checks
are reported yet, wait a few seconds and run it again. If any fail, fix them,
push again, and watch again. If you can't make them pass, stop and ask Dan.
Move the brief back to review only once they pass:
\`${toReview(brief.ref)}\`.

${avenSection(brief.ref)}

${ESCALATION}

${GITHUB_ETIQUETTE}
`;
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
}
