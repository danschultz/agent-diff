import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewMessage } from '../src/review-message.ts';

test('the review message is the one line from decision 0043', () => {
  assert.equal(
    reviewMessage('r_4m2x9p', 's_7kq9a1'),
    "[agent-diff review r_4m2x9p] The reviewer submitted review r_4m2x9p in session s_7kq9a1. Finish what you're doing first, then run `agent-diff review show r_4m2x9p`, address each comment, and reply to each one with `agent-diff comment reply`.",
  );
});
