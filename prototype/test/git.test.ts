// Checks that runGit's result depends on git's exit, not on whether git read
// its stdin.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GitError, runGit } from '../src/server/git.ts';
import { prototypeDir } from './helpers.ts';

// Larger than a pipe buffer, so git exits before taking all of it.
const unreadInput = 'x'.repeat(4 * 1024 * 1024);

describe('runGit', () => {
  it('resolves when git exits without reading its stdin', async () => {
    const result = await runGit(prototypeDir, ['--version'], {
      input: unreadInput,
    });
    assert.equal(result.code, 0);
    assert.match(result.stdout.toString('utf8'), /^git version /);
  });

  it('rejects with the exit code when git fails without reading its stdin', async () => {
    await assert.rejects(
      runGit(prototypeDir, ['rev-parse', '--verify', 'no-such-ref'], {
        input: unreadInput,
      }),
      (error) => {
        assert.ok(error instanceof GitError);
        assert.equal(error.code, 128);
        return true;
      },
    );
  });
});
