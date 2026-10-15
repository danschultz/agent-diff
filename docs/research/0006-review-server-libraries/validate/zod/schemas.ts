import * as z from 'zod';

export const CreateReviewSession = z.object({
  workingDirectories: z.array(z.string().startsWith('/')).min(1),
  title: z.string().max(200).optional(),
});

const RangeComment = z
  .object({
    kind: z.literal('range'),
    path: z.string().min(1),
    startLine: z.int().min(1),
    endLine: z.int().min(1),
    body: z.string().min(1),
  })
  .refine((c) => c.endLine >= c.startLine, {
    message: 'endLine must not be before startLine',
    path: ['endLine'],
  });

const OverallComment = z.object({
  kind: z.literal('overall'),
  body: z.string().min(1),
});

export const AddComment = z.discriminatedUnion('kind', [
  RangeComment,
  OverallComment,
]);

export type CreateReviewSession = z.infer<typeof CreateReviewSession>;
export type AddComment = z.infer<typeof AddComment>;

export function check(input: unknown) {
  const result = AddComment.safeParse(input);
  return result.success
    ? { ok: true as const, value: result.data }
    : { ok: false as const, message: z.prettifyError(result.error) };
}
