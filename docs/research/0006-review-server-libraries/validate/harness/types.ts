// Fails to compile unless the inferred types match the hand-written ones.
import type { AddComment, CreateReviewSession } from './schemas.ts';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

type ExpectedCreate = {
  workingDirectories: string[];
  title?: string | undefined;
};
type ExpectedComment =
  | {
      kind: 'range';
      path: string;
      startLine: number;
      endLine: number;
      body: string;
    }
  | { kind: 'overall'; body: string };

// Readonly arrays and optional-property spelling differ between libraries, so
// compare after removing readonly.
type Mutable<T> = T extends readonly (infer U)[]
  ? Mutable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: Mutable<T[K]> }
    : T;

export type Checks = [
  Expect<Equal<Mutable<CreateReviewSession>, ExpectedCreate>>,
  Expect<Equal<Mutable<AddComment>, ExpectedComment>>,
];
