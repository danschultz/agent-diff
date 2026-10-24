// The review server's API, declared contract-first. The review server
// implements it with `implement()` and serves it with `RPCHandler`, and the
// CLI and the review UI call it through `RPCLink`, typed as
// `ContractRouterClient<typeof contract>`. See decision 0025.
import { oc } from '@orpc/contract';
import * as v from 'valibot';
import {
  AddCommentInput,
  AddWorkingDirectoriesInput,
  AddWorkingDirectoriesOutput,
  ArchiveSessionOutput,
  CommentRef,
  DraftComment,
  EditCommentInput,
  Health,
  ListSessionsInput,
  NewSessionInput,
  ReplyInput,
  ReplyOutput,
  Review,
  ReviewDetails,
  ReviewRef,
  Session,
  SessionDetails,
  SessionIdInput,
  SessionRef,
  SessionReviews,
} from './schemas.ts';

export const contract = {
  // `server start` calls this on the saved port to tell whether the review
  // server is already running.
  health: oc.output(Health),
  // Named after the `agent-diff session` commands. A session ID that's
  // malformed or names no session fails with NOT_FOUND.
  session: {
    new: oc.input(NewSessionInput).output(Session),
    // Fails with CONFLICT when the session is archived.
    add: oc
      .input(AddWorkingDirectoriesInput)
      .output(AddWorkingDirectoriesOutput),
    show: oc.input(SessionRef).output(SessionDetails),
    // Newest first.
    list: oc.input(ListSessionsInput).output(v.array(Session)),
    archive: oc.input(SessionRef).output(ArchiveSessionOutput),
    delete: oc.input(SessionRef).output(v.void()),
  },
  // Comments and reviews, from decisions 0036, 0038, and 0043. An ID that's
  // malformed or names nothing fails with NOT_FOUND, and so does a comment
  // in the draft review given to `reply` or `resolve`, which agents can't
  // see. Every change fails with CONFLICT on an archived session.
  comment: {
    // Adds an overall comment to the session's draft review.
    add: oc.input(AddCommentInput).output(DraftComment),
    // Edit and delete a comment in the draft review, and fail with CONFLICT
    // on a submitted one.
    edit: oc.input(EditCommentInput).output(DraftComment),
    delete: oc.input(CommentRef).output(v.void()),
    // An agent's reply, which sets the comment's status, whatever it was.
    reply: oc.input(ReplyInput).output(ReplyOutput),
    // Resolves a submitted comment, whatever its status.
    resolve: oc.input(CommentRef).output(v.void()),
  },
  review: {
    // Fails with CONFLICT when the draft review is empty.
    submit: oc.input(SessionIdInput).output(Review),
    // A submitted review, as `agent-diff review show` prints it.
    show: oc.input(ReviewRef).output(ReviewDetails),
    // For the review UI: the session's submitted comments, its draft
    // review, and its submitted reviews.
    list: oc.input(SessionIdInput).output(SessionReviews),
  },
};

export type Contract = typeof contract;

// The path the API is served under. Everything else is the review UI.
export const apiPrefix = '/api';
