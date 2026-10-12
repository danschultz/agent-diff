import assert from 'node:assert/strict';
import { test } from 'node:test';
import { run } from '../src/exec.ts';

test('run kills a command that takes longer than its timeout', () => {
  const started = Date.now();
  assert.throws(() => run('sleep', ['10'], { timeoutMs: 200 }), /sleep 10 timed out after 0.2s/);
  assert.ok(Date.now() - started < 5000);
});

test('run returns stdout, and throws with stderr on a non-zero exit', () => {
  assert.equal(run('sh', ['-c', 'echo hi']), 'hi\n');
  assert.throws(() => run('sh', ['-c', 'echo oops >&2; exit 3']), /sh -c exited with 3: oops/);
});
