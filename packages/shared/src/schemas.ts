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

export const SessionDetails = v.object({
  ...Session.entries,
  workingDirectories: v.array(
    v.object({
      ...WorkingDirectory.entries,
      // Whether the directory no longer exists on disk.
      missing: v.boolean(),
    }),
  ),
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
