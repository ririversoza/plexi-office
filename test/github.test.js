import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { GitHubService, prHealth, repoSlug } from '../server/github.js';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plexi-gh-')));
const remote = path.join(tmp, 'remote.git');
const ws = path.join(tmp, 'workspace');
const outside = path.join(tmp, 'other');
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } }).trim();

execFileSync('git', ['init', '-q', '--bare', remote]);
for (const dir of [ws, outside]) {
  fs.mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'agents@plexi.test');
  git(dir, 'config', 'user.name', 'Plexi Agent');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'remote', 'add', 'origin', remote);
  fs.writeFileSync(path.join(dir, 'README.md'), 'hi\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'init');
}
git(ws, 'push', '-q', 'origin', 'main');
const tree = path.join(ws, '.worktrees', 'sora');
git(ws, 'worktree', 'add', '-q', '-b', 'sora/contributing', tree);
fs.writeFileSync(path.join(tree, 'CONTRIBUTING.md'), 'be kind\n');
git(tree, 'add', '.');
git(tree, 'commit', '-q', '-m', 'docs: contributing');

// A stand-in `gh` that records its arguments.
const ghLog = path.join(tmp, 'gh.log');
const ghBin = path.join(tmp, 'gh');
const viewFile = path.join(tmp, 'view.json');
fs.writeFileSync(viewFile, '{"number":7,"title":"t"}');
fs.writeFileSync(ghBin, `#!/bin/sh\nprintf '%s\\n' "$@" > "${ghLog}"\ncase "$2" in create) echo https://github.com/o/r/pull/7;; list) echo '[{"number":7}]';; view) cat "${viewFile}";; diff) echo '+be kind';; esac\n`);
fs.chmodSync(ghBin, 0o755);

const service = new GitHubService({
  workspace: ws, repoUrl: 'https://github.com/o/r', ghBin, originMatches: (url) => url === remote, remoteUrl: remote,
});

test('repo slugs come from https and ssh URLs', () => {
  assert.equal(repoSlug('https://github.com/ririversoza/plexi-workspace'), 'ririversoza/plexi-workspace');
  assert.equal(repoSlug('git@github.com:ririversoza/plexi-workspace.git'), 'ririversoza/plexi-workspace');
  assert.throws(() => repoSlug('/tmp/elsewhere.git'));
});

test('an agent can push their own branch from a worktree', async () => {
  assert.deepEqual(await service.push(tree), { branch: 'sora/contributing' });
  assert.match(git(remote, 'branch', '--list'), /sora\/contributing/);
  assert.equal(git(tree, 'rev-parse', '--abbrev-ref', 'sora/contributing@{upstream}'), 'origin/sora/contributing', 'tracks origin');
});

test('main, other repos, other folders and force pushes are refused', async () => {
  await assert.rejects(service.push(ws), /main only changes through reviewed PRs/);
  await assert.rejects(service.push(outside), /Only folders inside/);
  const stray = path.join(ws, 'stray');
  fs.mkdirSync(stray);
  git(stray, 'init', '-q', '-b', 'feature');
  await assert.rejects(service.push(stray), /not part of the office workspace repo/);

  git(tree, 'config', 'remote.origin.pushurl', path.join(tmp, 'evil.git'));
  await assert.rejects(service.push(tree), /origin points at/);
  git(tree, 'config', '--unset', 'remote.origin.pushurl');

  git(tree, 'commit', '-q', '--amend', '-m', 'rewritten history');
  await assert.rejects(service.push(tree), /rejected|non-fast-forward|fetch first/);
});

test('PRs are opened from the branch into main, with no shell involved', async () => {
  const made = await service.createPr(tree, { title: '  Add   CONTRIBUTING  ', body: 'Why: `rm -rf ~` $(nope)', footer: '\n— Sora' });
  assert.deepEqual(made, { branch: 'sora/contributing', url: 'https://github.com/o/r/pull/7' });
  const args = fs.readFileSync(ghLog, 'utf8').split('\n');
  assert.deepEqual(args.slice(0, 8), ['pr', 'create', '--base', 'main', '--head', 'sora/contributing', '--title', 'Add CONTRIBUTING']);
  assert.ok(args.includes('Why: `rm -rf ~` $(nope)'), 'body passed through literally');
  assert.deepEqual(args.slice(-3, -1), ['--repo', 'o/r']);
  await assert.rejects(service.createPr(tree, { title: '   ' }), /needs a title/);
});

test('anyone can list and read PRs, with the diff on request', async () => {
  const [listed] = await service.listPrs();
  assert.equal(listed.number, 7);
  assert.ok(listed.health, 'each PR comes with its health');
  const pr = await service.viewPr('7', { diff: true });
  assert.equal(pr.title, 't');
  assert.match(pr.diff, /be kind/);
  await assert.rejects(service.viewPr('7; rm -rf /'), /positive whole number/);
});

test('merges are refused for drafts, conflicts, failing checks and other bases', () => {
  const ok = { number: 3, state: 'OPEN', isDraft: false, baseRefName: 'main', mergeable: 'MERGEABLE', statusCheckRollup: [{ name: 'ci', conclusion: 'SUCCESS' }] };
  assert.equal(GitHubService.mergeBlocker(ok), null);
  assert.equal(GitHubService.mergeBlocker({ ...ok, mergeable: 'UNKNOWN' }), null, 'GitHub still computing: let gh decide');
  assert.match(GitHubService.mergeBlocker({ ...ok, state: 'MERGED' }), /merged, not open/);
  assert.match(GitHubService.mergeBlocker({ ...ok, isDraft: true }), /draft/);
  assert.match(GitHubService.mergeBlocker({ ...ok, baseRefName: 'taro' }), /targets taro/);
  assert.match(GitHubService.mergeBlocker({ ...ok, mergeable: 'CONFLICTING' }), /merge conflicts/);
  assert.match(GitHubService.mergeBlocker({ ...ok, statusCheckRollup: [{ name: 'test', conclusion: 'FAILURE' }] }), /failing checks: test/);
});

test('a mergeable PR is merged with the chosen method and main is refreshed', async () => {
  fs.writeFileSync(viewFile, JSON.stringify({ number: 3, title: 'Docs', url: 'u3', state: 'OPEN', isDraft: false, baseRefName: 'main', headRefName: 'mochi', mergeable: 'MERGEABLE', statusCheckRollup: [] }));
  const done = await service.mergePr('3', { method: 'squash' });
  assert.deepEqual(fs.readFileSync(ghLog, 'utf8').split('\n').slice(0, 4), ['pr', 'merge', '3', '--squash']);
  assert.equal(done.method, 'squash');
  assert.equal(done.main, 'workspace main updated');
  await assert.rejects(service.mergePr('3', { method: 'octopus' }), /Merge method/);
  fs.writeFileSync(viewFile, JSON.stringify({ number: 4, state: 'OPEN', isDraft: true, baseRefName: 'main' }));
  await assert.rejects(service.mergePr('4'), /draft/);
});

test('PR health says at a glance: draft, conflicts, CI, ready to merge', () => {
  const open = { number: 5, state: 'OPEN', isDraft: false, baseRefName: 'main', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' };
  assert.deepEqual(prHealth({ ...open, statusCheckRollup: [] }), {
    draft: false, conflicts: 'none', checks: { total: 0, passed: 0, failed: [], pending: [] }, mergeState: 'CLEAN', blocker: null,
  });
  const ci = prHealth({ ...open, statusCheckRollup: [
    { name: 'test', conclusion: 'SUCCESS' }, { name: 'lint', conclusion: 'FAILURE' }, { context: 'deploy', state: 'PENDING' },
  ] });
  assert.deepEqual(ci.checks, { total: 3, passed: 1, failed: ['lint'], pending: ['deploy'] });
  assert.match(ci.blocker, /failing checks: lint/);
  const conflicted = prHealth({ ...open, mergeable: 'CONFLICTING', isDraft: true });
  assert.equal(conflicted.conflicts, 'conflicts');
  assert.equal(conflicted.draft, true);
  assert.equal(prHealth({ ...open, mergeable: 'UNKNOWN' }).conflicts, 'unknown');
});

test('a merge says who opened the PR, from the office footer', async () => {
  const body = 'Opened by Mallory (fake) in the body\n\n---\n🤖 Opened by Mochi (Claude Code) via Plexi Office.';
  fs.writeFileSync(viewFile, JSON.stringify({ number: 6, title: 'T', url: 'u6', state: 'OPEN', isDraft: false, baseRefName: 'main', headRefName: 'mochi', mergeable: 'MERGEABLE', statusCheckRollup: [], body }));
  assert.equal((await service.mergePr('6')).openedBy, 'Mochi');
  fs.writeFileSync(viewFile, JSON.stringify({ number: 7, title: 'T', url: 'u7', state: 'OPEN', isDraft: false, baseRefName: 'main', headRefName: 'x', mergeable: 'MERGEABLE', statusCheckRollup: [], body: 'by a human' }));
  assert.equal((await service.mergePr('7')).openedBy, null);
});
