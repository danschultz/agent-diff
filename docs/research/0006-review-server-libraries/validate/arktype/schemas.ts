import { type } from 'arktype';

export const CreateReviewSession = type({
  workingDirectories: type(/^\//).array().atLeastLength(1),
  'title?': 'string <= 200',
});

const RangeComment = type({
  kind: "'range'",
  path: 'string > 0',
  startLine: 'number.integer >= 1',
  endLine: 'number.integer >= 1',
  body: 'string > 0',
}).narrow(
  (c, ctx) =>
    c.endLine >= c.startLine ||
    ctx.reject({
      message: 'endLine must not be before startLine',
      path: ['endLine'],
    }),
);

const OverallComment = type({ kind: "'overall'", body: 'string > 0' });

export const AddComment = RangeComment.or(OverallComment);

export type CreateReviewSession = typeof CreateReviewSession.infer;
export type AddComment = typeof AddComment.infer;

export function check(input: unknown) {
  const out = AddComment(input);
  return out instanceof type.errors
    ? { ok: false as const, message: out.summary }
    : { ok: true as const, value: out };
}
