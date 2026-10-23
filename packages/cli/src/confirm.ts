// Asks the user a yes-or-no question in the terminal.
import { createInterface } from 'node:readline/promises';

export type Confirm = (question: string) => Promise<boolean>;

// Asks on stdin, writing the question to stderr so stdout keeps only the
// command's output. Anything but y or yes is no.
export const confirmInTerminal: Confirm = async (question) => {
  const terminal = createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  try {
    const answer = await terminal.question(`${question} [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    terminal.close();
  }
};
