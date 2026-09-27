import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PERMISSIONS, resolvePermissions, sanitizePermissions } from '../server/permissions.js';
import { buildLaunch } from '../server/launch.js';

const claudeAgent = { id: 'a_1', name: 'Mochi', type: 'claude', role: 'worker' };
const codexAgent = { id: 'a_2', name: 'Kiwi', type: 'codex', role: 'worker' };
const launchOpts = { binPath: '/bin/true', pathEnv: '/bin', url: 'http://127.0.0.1:1', token: 't' };

function claudeSettings(spec) {
  return JSON.parse(spec.args[spec.args.indexOf('--settings') + 1]);
}

test('safe coding allows reads/tests, denies dangerous commands, accepts edits', () => {
  const { claude, codex } = resolvePermissions(DEFAULT_PERMISSIONS);
  assert.equal(DEFAULT_PERMISSIONS.preset, 'safe');
  assert.equal(claude.defaultMode, 'acceptEdits');
  assert.ok(claude.allow.includes('Read'));
  assert.ok(claude.allow.some((r) => r.startsWith('Bash(npm test')));
  assert.ok(claude.deny.some((r) => r.startsWith('Bash(rm -rf')));
  assert.ok(!claude.allow.some((r) => r.includes('git push')), 'pushing still asks the manager');
  assert.deepEqual(codex, { sandbox: 'workspace-write', approval: 'on-request' });
});

test('CLI defaults add nothing', () => {
  const { claude, codex } = resolvePermissions({ preset: 'cli' });
  assert.equal(claude, null);
  assert.equal(codex, null);
});

test('custom rules are validated', () => {
  const ok = sanitizePermissions({ preset: 'custom', allow: ['Read', 'Bash(make test*)'], deny: ['Bash(sudo *)'], acceptEdits: false });
  assert.deepEqual(resolvePermissions(ok).claude, { allow: ['Read', 'Bash(make test*)'], deny: ['Bash(sudo *)'] });
  assert.throws(() => sanitizePermissions({ preset: 'custom', allow: ['not a rule!'] }), /rule/);
  assert.throws(() => sanitizePermissions({ preset: 'yolo' }), /preset/);
  assert.throws(() => sanitizePermissions({ preset: 'custom', codexSandbox: 'danger-everything' }), /sandbox/);
});

test('launch passes Claude permissions in --settings and Codex sandbox flags', () => {
  const perms = resolvePermissions(DEFAULT_PERMISSIONS);
  const claude = claudeSettings(buildLaunch(claudeAgent, { ...launchOpts, permissions: perms }));
  assert.equal(claude.permissions.defaultMode, 'acceptEdits');
  assert.ok(claude.hooks.Stop, 'hooks are still there');
  const codex = buildLaunch(codexAgent, { ...launchOpts, permissions: perms });
  const at = codex.args.indexOf('--sandbox');
  assert.deepEqual(codex.args.slice(at, at + 2), ['--sandbox', 'workspace-write']);
  assert.ok(codex.args.includes('--ask-for-approval'));
  const plain = buildLaunch(codexAgent, { ...launchOpts, permissions: resolvePermissions({ preset: 'cli' }) });
  assert.ok(!plain.args.includes('--ask-for-approval'), 'cli preset keeps Codex approvals');
  assert.ok(plain.args.includes('--sandbox'), 'but the workspace sandbox always applies');
});
