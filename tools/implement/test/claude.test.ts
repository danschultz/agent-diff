import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { cleanEnv, inOwnScope } from '../src/claude.ts';

test('agent sessions reach GitHub over HTTPS with gh credentials, not SSH', () => {
  const env = { ...cleanEnv({ HOME: '/home/dan', PATH: '/usr/bin' }), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
  const url = (remote: string) => execFileSync('git', ['ls-remote', '--get-url', remote], { env, encoding: 'utf8' }).trim();
  assert.equal(url('git@github.com:dan/agent-diff.git'), 'https://github.com/dan/agent-diff.git');
  assert.equal(url('ssh://git@github.com/dan/agent-diff.git'), 'https://github.com/dan/agent-diff.git');
  const helper = execFileSync('git', ['config', '--get-urlmatch', 'credential.helper', 'https://github.com'], { env, encoding: 'utf8' }).trim();
  assert.equal(helper, '!gh auth git-credential');
});

test("the clean environment drops the caller's variables", () => {
  const env = cleanEnv({ HOME: '/home/dan', PATH: '/opt/wrapper/bin', CLAUDECODE: '1', SSH_AUTH_SOCK: '/tmp/agent' });
  assert.equal(env.CLAUDECODE, undefined);
  assert.equal(env.SSH_AUTH_SOCK, '/tmp/agent');
  assert.doesNotMatch(env.PATH!, /\/opt\/wrapper/);
});

test('background agent sessions start in their own systemd scope, so a tick exiting doesn\'t kill them', () => {
  const [cmd, args] = inOwnScope('/home/dan/.local/bin/claude', ['--bg', '--resume', 'abc', 'go']);
  assert.equal(cmd, 'systemd-run');
  assert.deepEqual(args.slice(0, 4), ['--user', '--scope', '--quiet', '--collect']);
  assert.match(args[4], /^--unit=implement-claude-[0-9a-f]{8}$/);
  assert.deepEqual(args.slice(5), ['--', '/home/dan/.local/bin/claude', '--bg', '--resume', 'abc', 'go']);
  assert.notEqual(inOwnScope('claude', [])[1][4], args[4]);
});
