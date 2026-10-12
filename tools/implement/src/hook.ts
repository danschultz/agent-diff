// Claude Code hooks for agent sessions started by `implement`. They're loaded
// only through the settings file `implement` passes to those agent sessions.

import { lastAssistantText } from './claude.ts';
import { LABELS } from './config.ts';
import { moveTo, type GitHub } from './github.ts';
import { findBrief, type State } from './state.ts';

const ALL_LABELS = Object.values(LABELS);

export interface HookInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  message?: string;
  notification_type?: string;
}

export interface HookDeps {
  state: State;
  github: (repo: string) => GitHub;
  log: (message: string) => void;
}

const MAX_QUESTION_LENGTH = 6000;

/**
 * Notification: the agent session is waiting for Dan, either for an answer or
 * for permission. Moves the brief to agent:needs-input and posts the question.
 */
export function onNotification(input: HookInput, deps: HookDeps): void {
  const brief = findBrief(deps.state, input.session_id, input.cwd);
  if (!brief) return;
  const github = deps.github(brief.repo);
  const issue = github.issue(brief.issue);
  if (issue.state !== 'OPEN') return;
  const permission = input.notification_type === 'permission_prompt';
  // Idle after finishing: the agent session moved the brief to review and is done.
  if (!permission && issue.labels.includes(LABELS.review)) return;
  // Already reported. Dan's answer moves the brief back to agent:working.
  if (issue.labels.includes(LABELS.needsInput)) return;

  let question = (input.transcript_path && lastAssistantText(input.transcript_path)) || '';
  if (question.length > MAX_QUESTION_LENGTH) question = `…${question.slice(-MAX_QUESTION_LENGTH)}`;
  const heading = permission
    ? `**The agent session is waiting for permission:** ${input.message ?? ''}`
    : '**The agent session needs input.**';
  const quoted = question ? `\n\n${question.split('\n').map((l) => `> ${l}`).join('\n')}` : '';
  moveTo(github, issue, LABELS.needsInput, ALL_LABELS);
  github.comment(
    issue.number,
    `${heading}${quoted}\n\nAnswer in the Claude app or on claude.ai/code (Remote Control session \`${brief.sessionName}\`), or over SSH with \`claude attach ${brief.sessionName}\`.`,
  );
  deps.log(`#${brief.issue}: needs input`);
}

/** UserPromptSubmit: Dan answered, so the brief goes back to agent:working. */
export function onPromptSubmit(input: HookInput, deps: HookDeps): void {
  const brief = findBrief(deps.state, input.session_id, input.cwd);
  if (!brief) return;
  const github = deps.github(brief.repo);
  const issue = github.issue(brief.issue);
  if (issue.labels.includes(LABELS.needsInput)) moveTo(github, issue, LABELS.working, ALL_LABELS);
}
