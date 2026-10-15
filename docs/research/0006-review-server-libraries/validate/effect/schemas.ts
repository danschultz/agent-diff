import { Result, Schema } from 'effect';

export const CreateReviewSession = Schema.Struct({
  workingDirectories: Schema.Array(
    Schema.String.check(Schema.isStartingWith('/')),
  ).check(Schema.isMinLength(1)),
  title: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
});

const line = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

const RangeComment = Schema.Struct({
  kind: Schema.Literal('range'),
  path: Schema.NonEmptyString,
  startLine: line,
  endLine: line,
  body: Schema.NonEmptyString,
}).check(
  Schema.makeFilter((c) =>
    c.endLine >= c.startLine
      ? undefined
      : { path: ['endLine'], issue: 'endLine must not be before startLine' },
  ),
);

const OverallComment = Schema.Struct({
  kind: Schema.Literal('overall'),
  body: Schema.NonEmptyString,
});

export const AddComment = Schema.Union([RangeComment, OverallComment]);

export type CreateReviewSession = typeof CreateReviewSession.Type;
export type AddComment = typeof AddComment.Type;

const decode = Schema.decodeUnknownResult(AddComment, { errors: 'all' });

export function check(input: unknown) {
  const result = decode(input);
  return Result.isSuccess(result)
    ? { ok: true as const, value: result.success }
    : { ok: false as const, message: result.failure.message };
}
