import * as v from 'valibot';

export const CreateReviewSession = v.object({
  workingDirectories: v.pipe(
    v.array(v.pipe(v.string(), v.startsWith('/'))),
    v.minLength(1),
  ),
  title: v.optional(v.pipe(v.string(), v.maxLength(200))),
});

const line = v.pipe(v.number(), v.integer(), v.minValue(1));

const RangeComment = v.pipe(
  v.object({
    kind: v.literal('range'),
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

const OverallComment = v.object({
  kind: v.literal('overall'),
  body: v.pipe(v.string(), v.minLength(1)),
});

export const AddComment = v.variant('kind', [RangeComment, OverallComment]);

export type CreateReviewSession = v.InferOutput<typeof CreateReviewSession>;
export type AddComment = v.InferOutput<typeof AddComment>;

export function check(input: unknown) {
  const result = v.safeParse(AddComment, input);
  return result.success
    ? { ok: true as const, value: result.output }
    : { ok: false as const, message: v.summarize(result.issues) };
}
