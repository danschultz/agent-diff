// Prints each library's messages for invalid input, then times parsing.
import { AddComment, check } from './schemas.ts';

const valid = {
  kind: 'range',
  path: 'src/a.ts',
  startLine: 3,
  endLine: 4,
  body: 'Rename this.',
};
const inputs: Record<string, unknown> = {
  'empty body, end before start': {
    kind: 'range',
    path: 'src/a.ts',
    startLine: 5,
    endLine: 2,
    body: '',
  },
  'line is a string': {
    kind: 'range',
    path: 'src/a.ts',
    startLine: '3',
    endLine: 4,
    body: 'x',
  },
  'unknown kind': { kind: 'file', body: 'x' },
  'not an object': 'hello',
};

if (process.argv.includes('--messages')) {
  console.log(
    `standard schema: ${'~standard' in (AddComment as object) ? 'yes' : 'no'}`,
  );
  const ok = check(valid);
  console.log(`valid: ${ok.ok}`);
  for (const [name, input] of Object.entries(inputs)) {
    const result = check(input);
    console.log(`--- ${name}\n${result.ok ? 'ACCEPTED' : result.message}`);
  }
}

if (process.argv.includes('--bench')) {
  const invalid = inputs['empty body, end before start'];
  for (const [name, input] of [
    ['valid', valid],
    ['invalid', invalid],
  ] as const) {
    const rates: number[] = [];
    for (let round = 0; round < 5; round++) {
      let n = 0;
      const end = performance.now() + 500;
      while (performance.now() < end)
        for (let i = 0; i < 100; i++, n++) check(input);
      rates.push(n / 0.5);
    }
    rates.sort((a, b) => a - b);
    console.log(`${name}: ${Math.round(rates[2]! / 1000)}k ops/s`);
  }
}
