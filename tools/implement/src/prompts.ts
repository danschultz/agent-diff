// The prompts `implement` gives agent sessions.

import { LABELS } from './config.ts';
import type { Issue, PullRequest, Review } from './github.ts';
import type { BriefState } from './state.ts';

const ESCALATION = `## When to stop and ask Dan

Stop and ask Dan instead of deciding alone when any of these is true:

- An escalation criterion in the brief applies.
- The work would cross the brief's out of scope boundary.
- The acceptance criteria can't all be met.
- Auto mode won't allow an action you need.

To ask: send Dan a push notification with a one-line summary, then end your
turn with the question as your last message. Don't guess and carry on. Dan
answers through Remote Control, and \`implement\` posts your question on the
issue for you.`;

const GITHUB_ETIQUETTE = `## GitHub

You act on GitHub as Dan's account. Never submit pull request reviews or reply
in review threads, since those look like Dan reviewing. To say something on
the pull request, use \`gh pr comment\`.`;

export function startPrompt(brief: BriefState, issue: Issue, baseBranch: string): string {
  return `You're implementing brief #${issue.number} in ${brief.repo}, unattended on a headless server. Nobody is watching this terminal.

# Brief #${issue.number}: ${issue.title}

${issue.url}

${issue.body.trim()}

# How to work

- You're in a git worktree on the branch \`${brief.branch}\`, created from
  \`origin/${baseBranch}\`.
- Read AGENTS.md first and follow it. This brief is an agreed task, so you can
  implement it without asking for agreement first.
- The goal is the outcome to deliver. Out of scope is a hard boundary.
- Commit as you go.

${ESCALATION}

## When you're done

1. Check each acceptance criterion, and run every verification step,
   recording the results.
2. Push the branch: \`git push -u origin ${brief.branch}\`.
3. Open a draft pull request against \`${baseBranch}\` with
   \`gh pr create --draft\`. Its body must contain:
   - "Closes #${issue.number}".
   - The acceptance criteria as a checklist, each checked if met, or left
     unchecked with the reason it's not met.
   - The verification results.
4. Move the brief to review:
   \`gh issue edit ${issue.number} --remove-label ${LABELS.working} --add-label ${LABELS.review}\`.

${GITHUB_ETIQUETTE}
`;
}

export function resumePrompt(brief: BriefState, pr: PullRequest, reviews: Review[]): string {
  const summaries = reviews
    .map((r) => `- Review ${r.id} by @${r.author} (${r.state}, ${r.submittedAt})${r.body.trim() ? `:\n\n${indent(r.body.trim())}` : ''}`)
    .join('\n');
  return `Dan reviewed pull request #${pr.number} (${pr.url}) for brief #${brief.issue}.

${summaries}

Read the review's inline comments with
\`gh api repos/${brief.repo}/pulls/${pr.number}/comments\` and the conversation with
\`gh pr view ${pr.number} --comments\`.

Address the feedback, rerun the brief's verification steps, update the pull
request body's checklist and verification results, and push. Then move the
brief back to review:
\`gh issue edit ${brief.issue} --remove-label ${LABELS.working} --add-label ${LABELS.review}\`.

${ESCALATION}

${GITHUB_ETIQUETTE}
`;
}

function indent(text: string): string {
  return text.split('\n').map((line) => `    ${line}`).join('\n');
}
