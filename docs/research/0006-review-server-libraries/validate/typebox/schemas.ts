import Type from 'typebox';
import { Compile } from 'typebox/compile';

export const CreateReviewSession = Type.Object({
  workingDirectories: Type.Array(Type.String({ pattern: '^/' }), {
    minItems: 1,
  }),
  title: Type.Optional(Type.String({ maxLength: 200 })),
});

const RangeComment = Type.Refine(
  Type.Object({
    kind: Type.Literal('range'),
    path: Type.String({ minLength: 1 }),
    startLine: Type.Integer({ minimum: 1 }),
    endLine: Type.Integer({ minimum: 1 }),
    body: Type.String({ minLength: 1 }),
  }),
  (c) => c.endLine >= c.startLine,
  () => 'endLine must not be before startLine',
);

const OverallComment = Type.Object({
  kind: Type.Literal('overall'),
  body: Type.String({ minLength: 1 }),
});

export const AddComment = Type.Union([RangeComment, OverallComment]);

export type CreateReviewSession = Type.Static<typeof CreateReviewSession>;
export type AddComment = Type.Static<typeof AddComment>;

const validator = Compile(AddComment);

export function check(input: unknown) {
  if (validator.Check(input)) return { ok: true as const, value: input };
  const message = validator
    .Errors(input)
    .map((e) => `${e.instancePath || '/'} ${e.message}`)
    .join('\n');
  return { ok: false as const, message };
}
