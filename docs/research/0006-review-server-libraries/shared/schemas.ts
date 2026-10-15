// Request and response shapes shared by every server example, so only the
// HTTP and API code differs between them.
import * as z from 'zod';

export const CreateReviewSession = z.object({
  workingDirectories: z.array(z.string().startsWith('/')).min(1),
  title: z.string().max(200).optional(),
});

export const AddComment = z
  .object({
    path: z.string().min(1),
    startLine: z.int().min(1),
    endLine: z.int().min(1),
    body: z.string().min(1),
  })
  .refine((c) => c.endLine >= c.startLine, {
    message: 'endLine must not be before startLine',
    path: ['endLine'],
  });

export const Comment = z.object({
  id: z.string(),
  reviewSessionId: z.string(),
  path: z.string(),
  startLine: z.int(),
  endLine: z.int(),
  body: z.string(),
  createdAt: z.string(),
});

export const ReviewSession = z.object({
  id: z.string(),
  title: z.string().nullable(),
  workingDirectories: z.array(z.string()),
  startedAt: z.string(),
  comments: z.array(Comment),
});

export const ErrorBody = z.object({ error: z.string() });

export type CreateReviewSession = z.infer<typeof CreateReviewSession>;
export type AddComment = z.infer<typeof AddComment>;
export type Comment = z.infer<typeof Comment>;
export type ReviewSession = z.infer<typeof ReviewSession>;
