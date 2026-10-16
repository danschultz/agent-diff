// The Valibot schemas for the API's inputs and outputs. The contract in
// contract.ts uses them, and the API's types are inferred from them.
import * as v from 'valibot';

export const Health = v.object({ ok: v.literal(true) });

// Placeholder for the hello world scaffolding, with the `hello` procedure and
// the `greetings` table. Remove it when real features land.
export const HelloInput = v.object({
  name: v.pipe(
    v.string('The name must be a string.'),
    v.trim(),
    v.minLength(1, 'The name must not be empty.'),
    v.maxLength(100, 'The name must be at most 100 characters.'),
  ),
});

export const HelloOutput = v.object({
  message: v.string(),
  // The number of rows in `greetings`, including the one just added.
  count: v.pipe(v.number(), v.integer(), v.minValue(1)),
});

export type HelloInput = v.InferOutput<typeof HelloInput>;
export type HelloOutput = v.InferOutput<typeof HelloOutput>;
