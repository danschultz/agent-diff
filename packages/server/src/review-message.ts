// The review message for a submitted review, from decision 0043. It's one
// line, so the listener prints it as is, and the review UI shows the same
// text for the reviewer to copy. Nothing else builds it.
export function reviewMessage(reviewId: string, sessionId: string): string {
  return `[agent-diff review ${reviewId}] The reviewer submitted review ${reviewId} in session ${sessionId}. Finish what you're doing first, then run \`agent-diff review show ${reviewId}\`, address each comment, and reply to each one with \`agent-diff comment reply\`.`;
}
