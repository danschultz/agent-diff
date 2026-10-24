// `agent-diff review` and `agent-diff comment` commands, from decisions 0036,
// 0038, and 0043. Their output is plain text written for agents.
import { defineCommand } from '@crustjs/core';
import {
  commentStatusLabels as statusLabels,
  type ReviewDetails,
} from '@agent-diff/shared/schemas';
import { callReviewServer } from '../client.ts';

export interface ReviewCommandOptions {
  env: NodeJS.ProcessEnv;
}

// A time in the local time zone, such as `2026-10-22 14:03`.
function localTime(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// The review in the shape 0043 gives: a header saying how to reply, then
// each overall comment with its status and its whole thread.
function formatReview(review: ReviewDetails): string {
  const lines = [
    `Review ${review.id} in session ${review.sessionId}, submitted ${localTime(review.submittedAt)}.`,
    'Address each comment, then reply to it with one of:',
    '  agent-diff comment reply <comment-id> --addressed <what changed>',
    '  agent-diff comment reply <comment-id> --needs-input <your question>',
  ];
  const overall = review.comments.filter((c) => c.kind === 'overall');
  if (overall.length > 0) lines.push('', '## Overall comments');
  for (const comment of overall) {
    lines.push(
      '',
      `### ${comment.id} (${statusLabels[comment.status]})`,
      '',
      comment.reviewId === review.id
        ? `Reviewer: ${comment.text}`
        : `Reviewer, review ${comment.reviewId}: ${comment.text}`,
      ...comment.replies.map(
        (reply) => `Agent, ${statusLabels[reply.status]}: ${reply.text}`,
      ),
    );
  }
  return lines.join('\n');
}

export function reviewCommand({ env }: ReviewCommandOptions) {
  const show = defineCommand(
    'show',
    {
      description:
        'Show the comments submitted in a review, each with its thread.',
    },
    (c) =>
      c
        .args({
          name: 'review-id',
          type: 'string',
          required: true,
          description: "The review's ID, such as r_4m2x9p",
        })
        .action(async ({ args, stdout }) => {
          const review = await callReviewServer(env, (client) =>
            client.review.show({ id: args['review-id'] }),
          );
          stdout(formatReview(review));
        }),
  );

  return defineCommand(
    'review',
    { description: 'Read reviews the reviewer submitted.' },
    (c) => c.add(show),
  );
}

export function commentCommand({ env }: ReviewCommandOptions) {
  const reply = defineCommand(
    'reply',
    {
      description:
        'Reply to a comment, which sets its status. Give exactly one of --addressed and --needs-input.',
    },
    (c) =>
      c
        .args({
          name: 'comment-id',
          type: 'string',
          required: true,
          description: "The comment's ID, such as c_8f3k2a",
        })
        .flags(
          {
            name: 'addressed',
            type: 'string',
            description: 'Mark the comment addressed, saying what changed',
          },
          {
            name: 'needs-input',
            type: 'string',
            description:
              'Mark the comment as needing input, with your question',
          },
        )
        .action(async ({ args, flags, stdout }) => {
          const addressed = flags.addressed;
          const needsInput = flags['needs-input'];
          if ((addressed === undefined) === (needsInput === undefined)) {
            throw new Error(
              'Give exactly one of --addressed and --needs-input.',
            );
          }
          const id = args['comment-id'];
          const { status } = await callReviewServer(env, (client) =>
            addressed !== undefined
              ? client.comment.reply({
                  id,
                  status: 'addressed',
                  text: addressed,
                })
              : client.comment.reply({
                  id,
                  status: 'needs_input',
                  text: needsInput!,
                }),
          );
          stdout(
            status === 'needs_input'
              ? `Replied to ${id}. It now needs input.`
              : `Replied to ${id}. It's now ${statusLabels[status]}.`,
          );
        }),
  );

  return defineCommand(
    'comment',
    { description: 'Reply to comments the reviewer submitted.' },
    (c) => c.add(reply),
  );
}
