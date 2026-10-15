// The shared schemas, written with Valibot instead of Zod. tools/sync-shared.sh
// copies this over shared/schemas.ts in this example.
import * as v from 'valibot';

export const CreateReviewSession = v.object({
  workingDirectories: v.pipe(
    v.array(v.pipe(v.string(), v.startsWith('/'))),
    v.minLength(1),
  ),
  title: v.optional(v.pipe(v.string(), v.maxLength(200))),
});

const line = v.pipe(v.number(), v.integer(), v.minValue(1));

export const AddComment = v.pipe(
  v.object({
    path: v.pipe(v.string(), v.minLength(1)),
    startLine: line,
    endLine: line,
    body: v.pipe(v.string(), v.minLength(1)),
  }),
  v.forward(
    v.partialCheck(
      [['startLine'], ['endLine']],
      (c) => c.endLine >= c.startLine,
      'endLine must not be before startLine',
    ),
    ['endLine'],
  ),
);

export const Comment = v.object({
  id: v.string(),
  reviewSessionId: v.string(),
  path: v.string(),
  startLine: v.pipe(v.number(), v.integer()),
  endLine: v.pipe(v.number(), v.integer()),
  body: v.string(),
  createdAt: v.string(),
});

export const ReviewSession = v.object({
  id: v.string(),
  title: v.nullable(v.string()),
  workingDirectories: v.array(v.string()),
  startedAt: v.string(),
  comments: v.array(Comment),
});

export type CreateReviewSession = v.InferOutput<typeof CreateReviewSession>;
export type AddComment = v.InferOutput<typeof AddComment>;
export type Comment = v.InferOutput<typeof Comment>;
export type ReviewSession = v.InferOutput<typeof ReviewSession>;
