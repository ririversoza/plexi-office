import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { isInsideWorkspace, quarantinePolicyFiles } from '../server/workspace.js';
import { claudeHookSettings, buildLaunch } from '../server/launch.js';
import { resolvePermissions } from '../server/permissions.js';
import { GUARD_SCRIPT } from '../server/config.js';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plexi-ws-')));
const root = path.join(tmp, 'workspace');
fs.mkdirSync(path.join(root, 'src'), { recursive: true });
fs.symlinkSync(os.homedir(), path.join(root, 'escape'));

test('paths inside the workspace are allowed, everything else is not', () => {
  assert.ok(isInsideWorkspace(root, root));
  assert.ok(isInsideWorkspace(path.join(root, 'src', 'new-file.js'), root), 'not-yet-created file');
  assert.ok(isInsideWorkspace('src/a.js', root, root), 'relative to cwd');
  assert.ok(!isInsideWorkspace(path.join(tmp, 'elsewhere.txt'), root));
  assert.ok(!isInsideWorkspace(path.join(root, '..', 'workspace-evil', 'x'), root), 'sibling with shared prefix');
  assert.ok(!isInsideWorkspace('../../etc/passwd', root, root));
  assert.ok(!isInsideWorkspace(path.join(root, 'escape', '.zshrc'), root), 'symlink pointing out');
  assert.ok(!isInsideWorkspace('', root));
});

function runGuard(payload, env = { PLEXI_WORKSPACE: root }) {
  const res = spawnSync(process.execPath, [GUARD_SCRIPT], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    env: { PATH: process.env.PATH, ...env },
    encoding: 'utf8',
  });
  assert.equal(res.status, 0);
  return res.stdout ? JSON.parse(res.stdout).hookSpecificOutput : null;
}

test('the edit guard hook blocks edits outside the workspace and fails closed', () => {
  assert.equal(runGuard({ tool_name: 'Edit', tool_input: { file_path: path.join(root, 'src', 'a.js') }, cwd: root }), null);
  assert.equal(runGuard({ tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: root }), null, 'other tools untouched');
  const out = runGuard({ tool_name: 'Write', tool_input: { file_path: path.join(os.homedir(), '.zshrc') }, cwd: root });
  assert.equal(out.permissionDecision, 'deny');
  assert.match(out.permissionDecisionReason, /only edit files inside/);
  assert.equal(runGuard({ tool_name: 'NotebookEdit', tool_input: { notebook_path: '/tmp/x.ipynb' }, cwd: root }).permissionDecision, 'deny');
  assert.equal(runGuard('not json').permissionDecision, 'deny');
  assert.equal(runGuard({ tool_name: 'Edit', tool_input: { file_path: path.join(root, 'a') } }, {}).permissionDecision, 'deny', 'no workspace set');
});

test('every CLI launches locked to the workspace, whatever the preset', () => {
  const settings = claudeHookSettings('/usr/bin/node', { memory: false });
  assert.equal(settings.sandbox.enabled, true);
  assert.equal(settings.sandbox.allowUnsandboxedCommands, false);
  assert.equal(settings.sandbox.network.allowLocalBinding, true, 'plexi reaches the office from inside the sandbox');
  assert.ok(!settings.sandbox.excludedCommands.some((c) => c.startsWith('plexi')), 'plexi stays sandboxed');
  assert.match(settings.hooks.PreToolUse[0].matcher, /Edit\|Write/);
  assert.match(settings.hooks.PreToolUse[0].hooks[0].command, /guard\.js/);

  const opts = { binPath: '/bin/x', pathEnv: '/bin', url: 'http://127.0.0.1:4777', token: 't' };
  const codexCli = buildLaunch({ id: 'a', name: 'Kiwi', type: 'codex', cwd: root }, { ...opts, permissions: resolvePermissions({ preset: 'cli' }) });
  assert.deepEqual(codexCli.args.slice(codexCli.args.indexOf('--sandbox'), codexCli.args.indexOf('--sandbox') + 2), ['--sandbox', 'workspace-write']);
  const codexOld = resolvePermissions({ preset: 'custom', codexSandbox: 'danger-full-access' });
  assert.equal(codexOld.codex.sandbox, 'workspace-write', 'an old full-access setting is clamped');
  const cursor = buildLaunch({ id: 'b', name: 'Nori', type: 'cursor', cwd: root }, opts);
  assert.deepEqual(cursor.args, ['--sandbox', 'enabled', '--workspace', root]);
  assert.ok(cursor.env.PLEXI_WORKSPACE);
});

test('the edit guard keeps agents out of the CLIs\' own config folders', () => {
  for (const file of ['.claude/settings.json', '.codex/config.toml', '.cursor/sandbox.json']) {
    const out = runGuard({ tool_name: 'Write', tool_input: { file_path: path.join(root, file) }, cwd: root });
    assert.equal(out?.permissionDecision, 'deny', file);
  }
  assert.equal(runGuard({ tool_name: 'Write', tool_input: { file_path: path.join(root, '.cursorrules') }, cwd: root }), null, 'similar names are fine');
});

test('a Cursor sandbox policy written into the workspace is moved aside, not applied', () => {
  fs.mkdirSync(path.join(root, '.cursor'), { recursive: true });
  const file = path.join(root, '.cursor', 'sandbox.json');
  fs.writeFileSync(file, JSON.stringify({ type: 'workspace_readwrite', additionalReadwritePaths: [os.homedir()] }));
  const moved = quarantinePolicyFiles(root, 123);
  assert.deepEqual(moved, [{ file, aside: `${file}.rejected-123` }]);
  assert.ok(!fs.existsSync(file));
  assert.ok(fs.existsSync(`${file}.rejected-123`), 'kept for review');
  assert.deepEqual(quarantinePolicyFiles(root), [], 'nothing left to move');
});

test('Claude ignores workspace settings files and Codex has network with no extra roots', () => {
  const opts = { binPath: '/bin/x', pathEnv: '/bin', url: 'http://127.0.0.1:4777', token: 't' };
  const claude = buildLaunch({ id: 'c', name: 'Mochi', type: 'claude', cwd: root }, opts);
  assert.equal(claude.args[claude.args.indexOf('--setting-sources') + 1], 'user');
  const sandbox = JSON.parse(claude.args[claude.args.indexOf('--settings') + 1]).sandbox;
  assert.ok(sandbox.filesystem.denyWrite.some((p) => p.endsWith('.cursor')));
  const codex = buildLaunch({ id: 'k', name: 'Kiwi', type: 'codex', cwd: root }, opts);
  assert.ok(codex.args.includes('sandbox_workspace_write.network_access=true'));
  assert.ok(codex.args.includes('sandbox_workspace_write.writable_roots=[]'));
});

test('agents commit unsigned under their own name, even with signing forced on in git config', () => {
  const repo = path.join(tmp, 'signed-repo');
  fs.mkdirSync(repo);
  const git = (env, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: tmp, ...env } }).trim();
  git({}, 'init', '-q', '-b', 'main');
  git({}, 'config', 'user.name', 'The Manager');
  git({}, 'config', 'user.email', 'manager@example.com');
  git({}, 'config', 'commit.gpgsign', 'true');
  git({}, 'config', 'gpg.format', 'ssh');
  git({}, 'config', 'user.signingkey', path.join(tmp, 'no-such-key'));
  fs.writeFileSync(path.join(repo, 'a.txt'), 'hi\n');
  git({}, 'add', '.');
  assert.throws(() => git({}, 'commit', '-q', '-m', 'as the manager'), 'signing is really on');
  const launch = buildLaunch({ id: 'k', name: 'Kiwi', type: 'codex', cwd: repo }, { binPath: '/bin/x', pathEnv: '/bin', url: 'http://x', token: 't' });
  const agentEnv = Object.fromEntries(Object.entries(launch.env).filter(([k]) => k.startsWith('GIT_')));
  git(agentEnv, 'commit', '-q', '-m', 'feat(kiwi): hello');
  assert.equal(git({}, 'log', '-1', '--format=%an <%ae> | %cn'), 'Kiwi (Plexi agent) <kiwi@agents.plexi.invalid> | Kiwi (Plexi agent)');
});
