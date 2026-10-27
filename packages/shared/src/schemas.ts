// The Valibot schemas for the API's inputs and outputs. The contract in
// contract.ts uses them, and the API's types are inferred from them.
import * as v from 'valibot';

export const Health = v.object({ ok: v.literal(true) });

// Any string is accepted, and one that's malformed names no session, so it
// fails the same way as an unknown ID.
const SessionId = v.string('The session ID must be a string.');

// The CLI resolves relative paths against its current directory, so the
// review server only gets absolute ones. The review UI imports this too, so
// it can't use node:path.
const WorkingDirectoryPaths = v.pipe(
  v.array(
    v.pipe(
      v.string('A working directory must be a string.'),
      v.check(
        (path) => path.startsWith('/'),
        (issue) =>
          `The working directory ${String(issue.input)} isn't an absolute path.`,
      ),
    ),
    'The working directories must be an array.',
  ),
  v.minLength(1, 'Give at least one working directory.'),
);

const BaseRef = v.pipe(
  v.string('The base ref must be a string.'),
  v.minLength(1, 'The base ref must not be empty.'),
);

export const NewSessionInput = v.object({
  title: v.optional(
    v.pipe(
      v.string('The title must be a string.'),
      v.trim(),
      v.minLength(1, 'The title must not be empty.'),
      v.maxLength(200, 'The title must be at most 200 characters.'),
    ),
  ),
  // Applies to every working directory that uses git.
  base: v.optional(BaseRef),
  workingDirectories: WorkingDirectoryPaths,
});

export const AddWorkingDirectoriesInput = v.object({
  id: SessionId,
  base: v.optional(BaseRef),
  workingDirectories: WorkingDirectoryPaths,
});

export const SessionRef = v.object({ id: SessionId });

export const ListSessionsInput = v.object({
  // Includes archived sessions.
  all: v.optional(v.boolean('`all` must be a boolean.'), false),
});

// A working directory's membership in a session. Its path is the real path,
// with symlinks resolved, and its base ref is null when it doesn't use git.
export const WorkingDirectory = v.object({
  path: v.string(),
  baseRef: v.nullable(v.string()),
});

// Timestamps are ISO 8601 strings in UTC.
export const Session = v.object({
  id: v.string(),
  title: v.nullable(v.string()),
  createdAt: v.string(),
  // Null while the session is active.
  archivedAt: v.nullable(v.string()),
  workingDirectories: v.array(WorkingDirectory),
});

// A comment's status, from decisions 0038 and 0043.
export const CommentStatus = v.picklist([
  'open',
  'addressed',
  'needs_input',
  'resolved',
]);

// How a comment status is written for reviewers and agents, such as
// `needs input`, in the order they're listed.
export const commentStatusLabels = {
  open: 'open',
  addressed: 'addressed',
  needs_input: 'needs input',
  resolved: 'resolved',
} as const satisfies Record<v.InferOutput<typeof CommentStatus>, string>;

// How many submitted comments in a session have each status. The draft
// review isn't counted.
export const CommentCounts = v.object({
  open: v.number(),
  addressed: v.number(),
  needs_input: v.number(),
  resolved: v.number(),
});

export const SessionDetails = v.object({
  ...Session.entries,
  workingDirectories: v.array(
    v.object({
      ...WorkingDirectory.entries,
      // Whether the directory no longer exists on disk.
      missing: v.boolean(),
    }),
  ),
  commentCounts: CommentCounts,
});

export const AddWorkingDirectoriesOutput = v.object({
  // Each working directory the call named, once, in the order given.
  workingDirectories: v.array(
    v.object({
      ...WorkingDirectory.entries,
      // Whether it was in the session already, so it was kept as it was.
      alreadyInSession: v.boolean(),
    }),
  ),
});

export const ArchiveSessionOutput = v.object({
  archivedAt: v.string(),
  alreadyArchived: v.boolean(),
});

// Like session IDs, any string is accepted, and one that's malformed names
// nothing.
const CommentId = v.string('The comment ID must be a string.');
const ReviewId = v.string('The review ID must be a string.');

// Comments and replies are plain text, trimmed, and 1 to 10,000 characters
// (0043).
function text(what: 'comment' | 'reply') {
  return v.pipe(
    v.string(`The ${what} must be a string.`),
    v.trim(),
    v.minLength(1, `The ${what} must not be empty.`),
    v.maxLength(10_000, `The ${what} must be at most 10,000 characters.`),
  );
}

// Names a session for the comment and review procedures.
export const SessionIdInput = v.object({ sessionId: SessionId });

export const AddCommentInput = v.object({
  sessionId: SessionId,
  text: text('comment'),
});

export const EditCommentInput = v.object({
  id: CommentId,
  text: text('comment'),
});

export const CommentRef = v.object({ id: CommentId });

// The statuses an agent's reply can set, from `--addressed` and
// `--needs-input`.
export const ReplyStatus = v.picklist(
  ['addressed', 'needs_input'],
  "The reply's status must be addressed or needs_input.",
);

export const ReplyInput = v.object({
  id: CommentId,
  status: ReplyStatus,
  text: text('reply'),
});

export const ReviewRef = v.object({ id: ReviewId });

// A comment in the draft review, which only the reviewer sees.
export const DraftComment = v.object({
  id: v.string(),
  kind: v.literal('overall'),
  text: v.string(),
  createdAt: v.string(),
});

// An agent's reply in a comment's thread. Replies have no public ID.
export const Reply = v.object({
  author: v.literal('agent'),
  status: ReplyStatus,
  text: v.string(),
  createdAt: v.string(),
});

// A submitted comment, with the review it was submitted in, its status, and
// its replies, oldest first.
export const Comment = v.object({
  ...DraftComment.entries,
  reviewId: v.string(),
  status: CommentStatus,
  replies: v.array(Reply),
});

// A submitted review, with the review message the agent gets for it.
export const Review = v.object({
  id: v.string(),
  sessionId: v.string(),
  submittedAt: v.string(),
  message: v.string(),
});

// What `review show` prints: the comments submitted in the review, oldest
// first, each with its whole thread.
export const ReviewDetails = v.object({
  id: v.string(),
  sessionId: v.string(),
  submittedAt: v.string(),
  comments: v.array(Comment),
});

// Everything the review UI's comment panel shows for a session: its
// submitted comments, oldest first, its draft review, and its submitted
// reviews, newest first.
export const SessionReviews = v.object({
  comments: v.array(Comment),
  draftReview: v.object({ comments: v.array(DraftComment) }),
  reviews: v.array(Review),
});

export const ReplyOutput = v.object({
  id: v.string(),
  status: CommentStatus,
});

// A diff mode (0044). Only All changes, `all`, is served so far.
export const DiffMode = v.picklist(
  ['all'],
  (issue) =>
    `The diff mode ${JSON.stringify(issue.input)} isn't supported. Only all, for All changes, is.`,
);

// A file's git status in a diff mode. The status of a file that's binary,
// a symlink, or a submodule is git's, as for any other file.
export const FileStatus = v.picklist([
  'added',
  'modified',
  'deleted',
  'renamed',
  'copied',
  'type_changed',
  'conflicted',
  'untracked',
]);

// A changed file in a working directory's file list. Paths are relative to
// the working directory, with `/` between segments. The line counts are null
// when git, or the review server for an untracked file, finds the file
// binary, or when it's a submodule that isn't in git yet.
export const ChangedFile = v.object({
  path: v.string(),
  // Set when the file was renamed or copied.
  oldPath: v.nullable(v.string()),
  status: FileStatus,
  added: v.nullable(v.number()),
  removed: v.nullable(v.number()),
});

// What a working directory shows in a diff mode, by its real path.
export const WorkingDirectoryDiff = v.variant('kind', [
  // Uses git, and its changes were worked out. `mergeBase` is the commit the
  // diff compares from: the merge-base of the base ref and HEAD, or the base
  // ref's own commit when they have none, and null when HEAD is unborn, which
  // compares from the empty tree. Files are sorted by path.
  v.object({
    kind: v.literal('git'),
    path: v.string(),
    baseRef: v.string(),
    mergeBase: v.nullable(v.string()),
    files: v.array(ChangedFile),
  }),
  // Uses git, but its changes couldn't be worked out, such as when its base
  // ref doesn't resolve.
  v.object({
    kind: v.literal('error'),
    path: v.string(),
    baseRef: v.string(),
    message: v.string(),
  }),
  // Doesn't use git, so it has no diff, and its files aren't listed yet.
  v.object({ kind: v.literal('no_git'), path: v.string() }),
  // No longer exists on disk.
  v.object({
    kind: v.literal('missing'),
    path: v.string(),
    baseRef: v.nullable(v.string()),
  }),
]);

// Every working directory in a session, in the order they were added.
export const SessionDiff = v.object({
  workingDirectories: v.array(WorkingDirectoryDiff),
});

export const DiffFilesInput = v.object({
  sessionId: SessionId,
  mode: DiffMode,
});

// A path in a working directory's file list. Absolute paths and paths with
// `..` are rejected before the file list is checked.
const FilePath = v.pipe(
  v.string('The file path must be a string.'),
  v.minLength(1, 'The file path must not be empty.'),
  v.check(
    (path) => !path.startsWith('/'),
    (issue) =>
      `The file path ${String(issue.input)} must be relative to its working directory.`,
  ),
  v.check(
    (path) => !path.split('/').includes('..'),
    (issue) => `The file path ${String(issue.input)} must not contain "..".`,
  ),
);

export const FileContentsInput = v.object({
  sessionId: SessionId,
  mode: DiffMode,
  // The working directory's real path, as the session has it.
  workingDirectory: v.string('The working directory must be a string.'),
  path: FilePath,
});

// One side of a changed file. A symlink's text is its target. A side is
// binary when its first 8,000 bytes contain a NUL byte, and too large when
// it's over 2 MB.
export const FileSide = v.variant('type', [
  v.object({ type: v.literal('text'), text: v.string() }),
  v.object({ type: v.literal('binary') }),
  v.object({ type: v.literal('too_large'), size: v.number() }),
  v.object({ type: v.literal('submodule') }),
]);

// A changed file's two sides. A side is null when the file isn't there,
// such as the old side of an added file, or the new side of a deleted one.
export const FileContents = v.object({
  old: v.nullable(FileSide),
  new: v.nullable(FileSide),
});

export type NewSessionInput = v.InferOutput<typeof NewSessionInput>;
export type AddWorkingDirectoriesInput = v.InferOutput<
  typeof AddWorkingDirectoriesInput
>;
export type WorkingDirectory = v.InferOutput<typeof WorkingDirectory>;
export type Session = v.InferOutput<typeof Session>;
export type SessionDetails = v.InferOutput<typeof SessionDetails>;
export type AddWorkingDirectoriesOutput = v.InferOutput<
  typeof AddWorkingDirectoriesOutput
>;
export type ArchiveSessionOutput = v.InferOutput<typeof ArchiveSessionOutput>;
export type CommentStatus = v.InferOutput<typeof CommentStatus>;
export type CommentCounts = v.InferOutput<typeof CommentCounts>;
export type ReplyStatus = v.InferOutput<typeof ReplyStatus>;
export type DraftComment = v.InferOutput<typeof DraftComment>;
export type Reply = v.InferOutput<typeof Reply>;
export type Comment = v.InferOutput<typeof Comment>;
export type Review = v.InferOutput<typeof Review>;
export type ReviewDetails = v.InferOutput<typeof ReviewDetails>;
export type SessionReviews = v.InferOutput<typeof SessionReviews>;
export type DiffMode = v.InferOutput<typeof DiffMode>;
export type FileStatus = v.InferOutput<typeof FileStatus>;
export type ChangedFile = v.InferOutput<typeof ChangedFile>;
export type WorkingDirectoryDiff = v.InferOutput<typeof WorkingDirectoryDiff>;
export type SessionDiff = v.InferOutput<typeof SessionDiff>;
export type FileSide = v.InferOutput<typeof FileSide>;
export type FileContents = v.InferOutput<typeof FileContents>;
