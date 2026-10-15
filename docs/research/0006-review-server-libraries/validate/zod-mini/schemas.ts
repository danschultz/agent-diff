import { en } from 'zod/locales';
import * as z from 'zod/mini';

// zod/mini doesn't load error messages by default.
z.config(en());

export const CreateReviewSession = z.object({
  workingDirectories: z
    .array(z.string().check(z.startsWith('/')))
    .check(z.minLength(1)),
  title: z.optional(z.string().check(z.maxLength(200))),
});

const RangeComment = z
  .object({
    kind: z.literal('range'),
    path: z.string().check(z.minLength(1)),
    startLine: z.int().check(z.gte(1)),
    endLine: z.int().check(z.gte(1)),
    body: z.string().check(z.minLength(1)),
  })
  .check(
    z.refine((c) => c.endLine >= c.startLine, {
      message: 'endLine must not be before startLine',
      path: ['endLine'],
    }),
  );

const OverallComment = z.object({
  kind: z.literal('overall'),
  body: z.string().check(z.minLength(1)),
});

export const AddComment = z.discriminatedUnion('kind', [
  RangeComment,
  OverallComment,
]);

export type CreateReviewSession = z.infer<typeof CreateReviewSession>;
export type AddComment = z.infer<typeof AddComment>;

export function check(input: unknown) {
  const result = z.safeParse(AddComment, input);
  return result.success
    ? { ok: true as const, value: result.data }
    : { ok: false as const, message: z.prettifyError(result.error) };
}
