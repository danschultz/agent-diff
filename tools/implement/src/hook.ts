// Claude Code hooks for agent sessions started by `implement`. They're loaded
// only through the settings file `implement` passes to those agent sessions.

import { AGENT, isClosed, moveTo, type Aven } from './aven.ts';
import { lastAssistantText } from './claude.ts';
import { findBrief, type State } from './state.ts';

export interface HookInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  message?: string;
  notification_type?: string;
}

export interface HookDeps {
  state: State;
  aven: Aven;
  log: (message: string) => void;
}

const MAX_QUESTION_LENGTH = 6000;

/**
 * Notification: the agent session is waiting for Dan, either for an answer or
 * for permission. Moves the brief to agent=needs-input and adds the question
 * to the task as a note.
 */
export function onNotification(input: HookInput, deps: HookDeps): void {
  const brief = findBrief(deps.state, input.session_id, input.cwd);
  if (!brief) return;
  const task = deps.aven.task(brief.taskId);
  // Being let go: Dan is finished with it, and the next tick stops the agent session.
  if (isClosed(task) || task.agent === undefined) return;
  const permission = input.notification_type === 'permission_prompt';
  // Idle after finishing: the agent session moved the brief to review and is done.
  if (!permission && task.agent === AGENT.review) return;
  // Already reported. Dan's answer moves the brief back to agent=working.
  if (task.agent === AGENT.needsInput) return;

  let question =
    (input.transcript_path && lastAssistantText(input.transcript_path)) || '';
  if (question.length > MAX_QUESTION_LENGTH)
    question = `…${question.slice(-MAX_QUESTION_LENGTH)}`;
  const heading = permission
    ? `**The agent session is waiting for permission:** ${input.message ?? ''}`
    : '**The agent session needs input.**';
  const quoted = question
    ? `\n\n${question
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n')}`
    : '';
  moveTo(deps.aven, task, AGENT.needsInput);
  deps.aven.note(
    task.id,
    `${heading}${quoted}\n\nAnswer in the Claude app or on claude.ai/code (Remote Control session \`${brief.sessionName}\`), or over SSH with \`claude attach ${brief.sessionName}\`.`,
  );
  deps.log(`${task.ref}: needs input`);
}

/** UserPromptSubmit: Dan answered, so the brief goes back to agent=working. */
export function onPromptSubmit(input: HookInput, deps: HookDeps): void {
  const brief = findBrief(deps.state, input.session_id, input.cwd);
  if (!brief) return;
  const task = deps.aven.task(brief.taskId);
  if (task.agent === AGENT.needsInput) moveTo(deps.aven, task, AGENT.working);
}
