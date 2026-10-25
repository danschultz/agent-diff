// IDs that people copy into prompts, from decision 0040: a prefix, then 6
// random characters of lowercase Crockford base32, which leaves out i, l, o,
// and u, such as `s_7kq9a1` for a session, `c_8f3k2a` for a comment, and
// `r_4m2x9p` for a review (0043). An ID isn't checked against the ones
// already taken, and a collision fails the insert (0046).
import { randomBytes } from 'node:crypto';

export const idAlphabet = '0123456789abcdefghjkmnpqrstvwxyz';

function newId(prefix: string): string {
  let id = `${prefix}_`;
  // 256 is a multiple of 32, so the low 5 bits of each byte pick every
  // character with the same chance.
  for (const byte of randomBytes(6)) id += idAlphabet[byte & 31];
  return id;
}

export function newSessionId(): string {
  return newId('s');
}

export function newCommentId(): string {
  return newId('c');
}

export function newReviewId(): string {
  return newId('r');
}
