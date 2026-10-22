// IDs that people copy into prompts, from decision 0039: a prefix, then 6
// random characters of lowercase Crockford base32, which leaves out i, l, o,
// and u, such as `s_7kq9a1` for a session. Comments will get `c_`.
import { randomBytes } from 'node:crypto';

export const idAlphabet = '0123456789abcdefghjkmnpqrstvwxyz';

function newId(prefix: string): string {
  let id = `${prefix}_`;
  // 256 is a multiple of 32, so the low 5 bits of each byte pick every
  // character with the same chance.
  for (const byte of randomBytes(6)) id += idAlphabet[byte & 31];
  return id;
}

// A new session ID, which may already be taken. The store generates another
// when it is.
export function newSessionId(): string {
  return newId('s');
}
