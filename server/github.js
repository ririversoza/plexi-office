import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isInsideWorkspace } from './workspace.js';

const run = promisify(execFile);
const TIMEOUT_MS = 60_000;
const MAX_DIFF_CHARS = 20_000;
const MAX_TITLE = 200;
const MAX_BODY = 20_000;
export const BRANCH_RE = /^(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;
const PROTECTED_BRANCHES = new Set(['main', 'master', 'HEAD']);
const HEALTH_FIELDS = 'state,isDraft,baseRefName,mergeable,mergeStateStatus,statusCheckRollup';
const PR_LIST_FIELDS = `number,title,headRefName,author,url,updatedAt,reviewDecision,${HEALTH_FIELDS}`;
const MERGE_METHODS = ['merge', 'squash', 'rebase'];
const MERGE_CHECK_FIELDS = 'number,title,url,state,isDraft,baseRefName,headRefName,mergeable,statusCheckRollup,body';
const FAILED_CHECKS = new Set(['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);
const PR_VIEW_FIELDS = `number,title,body,headRefName,url,author,additions,deletions,files,commits,comments,reviews,reviewDecision,${HEALTH_FIELDS}`;
const PENDING_CHECKS = new Set(['QUEUED', 'IN_PROGRESS', 'PENDING', 'EXPECTED', 'WAITING', 'REQUESTED']);

export class GitError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function prNumber(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new GitError(400, 'PR number must be a positive whole number.');
  return n;
}

/**
 * The things a reviewer needs at a glance: draft, conflicts with main, CI, and whether
 * `plexi pr merge` would go through (null blocker = ready).
 */
/** The agent named in the office footer `plexi pr create` adds. The last one wins, since the footer comes last. */
export function openedBy(body) {
  const found = [...String(body || '').matchAll(/Opened by (.+?) \([^()]*\) via Plexi Office\./g)];
  return found.length ? found.at(-1)[1] : null;
}

export function prHealth(pr) {
  const checks = (pr.statusCheckRollup || []).map((c) => ({ name: c.name || c.context || 'check', result: c.conclusion || c.state || c.status || '' }));
  const failed = checks.filter((c) => FAILED_CHECKS.has(c.result)).map((c) => c.name);
  const pending = checks.filter((c) => PENDING_CHECKS.has(c.result)).map((c) => c.name);
  const conflicts = pr.mergeable === 'CONFLICTING' ? 'conflicts' : pr.mergeable === 'MERGEABLE' ? 'none' : 'unknown';
  return {
    draft: Boolean(pr.isDraft),
    conflicts,
    checks: { total: checks.length, passed: checks.length - failed.length - pending.length, failed, pending },
    mergeState: pr.mergeStateStatus || null,
    blocker: GitHubService.mergeBlocker(pr),
  };
}

/** "https://github.com/owner/repo" → "owner/repo". */
export function repoSlug(url) {
  const m = /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(String(url));
  if (!m) throw new Error(`Not a GitHub repo URL: ${url}`);
  return `${m[1]}/${m[2]}`;
}

/** The git/gh subcommand, skipping leading `-C dir` / `-c key=value` pairs. */
function subcommand(args) {
  let i = 0;
  while (args[i] === '-C' || args[i] === '-c') i += 2;
  return args[i] || '';
}

function cleanError(err) {
  const text = String(err.stderr || err.stdout || err.message || '').trim();
  return text.split('\n').filter(Boolean).slice(-6).join('\n').slice(0, 800) || 'failed';
}

/**
 * Pushes and opens pull requests for agents, from outside their sandboxes, with
 * your own git and `gh` login. Only for folders in the office workspace repo;
 * never pushes main, never force-pushes. Nothing goes through a shell.
 */
export class GitHubService {
  constructor({ workspace, repoUrl, getPath = async () => process.env.PATH, ghBin = 'gh', originMatches = null, remoteUrl = null }) {
    this.workspace = workspace;
    this.slug = repoSlug(repoUrl);
    // Pushes and fetches go over HTTPS with your `gh` login, not SSH: a passphrase-protected
    // key that isn't loaded in ssh-agent would otherwise fail with "Permission denied (publickey)".
    this.remoteUrl = remoteUrl || `https://github.com/${this.slug}.git`;
    this.originMatches = originMatches || ((url) => repoSlug(url).toLowerCase() === this.slug.toLowerCase());
    this.getPath = getPath;
    this.ghBin = ghBin;
  }

  async exec(bin, args, cwd) {
    const env = {
      ...process.env,
      PATH: await this.getPath(),
      GIT_TERMINAL_PROMPT: '0',
      // A locked SSH key fails fast instead of waiting for a passphrase no one can type.
      GIT_SSH_COMMAND: 'ssh -o BatchMode=yes',
      GH_PROMPT_DISABLED: '1',
    };
    try {
      const { stdout } = await run(bin, args, { cwd, env, timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 });
      return stdout;
    } catch (err) {
      throw new GitError(502, `${path.basename(bin)} ${subcommand(args)}: ${cleanError(err)}`);
    }
  }

  git(dir, ...args) {
    return this.exec('git', ['-C', dir, ...args], dir);
  }

  /** git with `gh` as the only credential helper, for talking to GitHub. */
  gitRemote(dir, ...args) {
    return this.git(dir, '-c', 'credential.helper=', '-c', `credential.helper=!${this.ghBin} auth git-credential`, ...args);
  }

  gh(...args) {
    return this.exec(this.ghBin, [...args, '--repo', this.slug], this.workspace);
  }

  /** The folder must be the workspace repo or one of its worktrees, and on a pushable branch. */
  async branchFor(dir) {
    if (!dir || !isInsideWorkspace(dir, this.workspace)) {
      throw new GitError(400, `Only folders inside ${this.workspace} can be pushed.`);
    }
    const common = (await this.git(dir, 'rev-parse', '--path-format=absolute', '--git-common-dir')).trim();
    if (fs.realpathSync(common) !== fs.realpathSync(path.join(this.workspace, '.git'))) {
      throw new GitError(400, `${dir} is not part of the office workspace repo.`);
    }
    // Both the fetch and the push URL: a pushurl could otherwise send work elsewhere.
    for (const args of [['get-url', 'origin'], ['get-url', '--push', 'origin']]) {
      const url = (await this.git(dir, 'remote', ...args)).trim();
      let ok = false;
      try {
        ok = this.originMatches(url);
      } catch {
        ok = false;
      }
      if (!ok) throw new GitError(400, `origin points at ${url}, not ${this.slug}.`);
    }
    const branch = (await this.git(dir, 'rev-parse', '--abbrev-ref', 'HEAD')).trim();
    if (PROTECTED_BRANCHES.has(branch)) {
      throw new GitError(403, `You're on ${branch === 'HEAD' ? 'a detached HEAD' : branch}. Work on your own branch; main only changes through reviewed PRs.`);
    }
    if (!BRANCH_RE.test(branch)) throw new GitError(400, `Branch name "${branch}" isn't allowed.`);
    return branch;
  }

  async push(dir) {
    const branch = await this.branchFor(dir);
    const ref = `refs/heads/${branch}`;
    // No "+" in the refspec and no --force: a push that would rewrite history is refused.
    await this.gitRemote(dir, 'push', this.remoteUrl, `${ref}:${ref}`);
    // Pushing to a URL doesn't update origin/<branch>; fetch it so upstream tracking works.
    await this.gitRemote(dir, 'fetch', this.remoteUrl, `+${ref}:refs/remotes/origin/${branch}`);
    await this.git(dir, 'branch', `--set-upstream-to=origin/${branch}`, branch).catch(() => {});
    return { branch };
  }

  async fetch(dir) {
    await this.branchFor(dir);
    await this.gitRemote(dir, 'fetch', '--prune', this.remoteUrl, '+refs/heads/*:refs/remotes/origin/*');
    return { ok: true };
  }

  async createPr(dir, { title, body = '', draft = false, footer = '' }) {
    const branch = await this.branchFor(dir);
    const cleanTitle = String(title || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
    if (!cleanTitle) throw new GitError(400, 'A PR needs a title (--title "...").');
    const text = `${String(body).slice(0, MAX_BODY)}${footer}`;
    const out = await this.gh('pr', 'create', '--base', 'main', '--head', branch, '--title', cleanTitle, '--body', text, ...(draft ? ['--draft'] : []));
    return { branch, url: out.trim().split('\n').pop() };
  }

  async listPrs() {
    const prs = JSON.parse((await this.gh('pr', 'list', '--state', 'open', '--limit', '50', '--json', PR_LIST_FIELDS)) || '[]');
    return prs.map((pr) => ({ ...pr, health: prHealth(pr) }));
  }

  async viewPr(number, { diff = false } = {}) {
    const n = prNumber(number);
    const found = JSON.parse(await this.gh('pr', 'view', String(n), '--json', PR_VIEW_FIELDS));
    const pr = { ...found, health: prHealth(found) };
    if (!diff) return pr;
    const text = await this.gh('pr', 'diff', String(n));
    return { ...pr, diff: text.length > MAX_DIFF_CHARS ? `${text.slice(0, MAX_DIFF_CHARS)}\n… (diff truncated)` : text };
  }

  /** Why a PR can't be merged yet, or null when it can. */
  static mergeBlocker(pr) {
    if (pr.state !== 'OPEN') return `#${pr.number} is ${String(pr.state).toLowerCase()}, not open.`;
    if (pr.isDraft) return `#${pr.number} is still a draft.`;
    if (pr.baseRefName !== 'main') return `#${pr.number} targets ${pr.baseRefName}, not main.`;
    if (pr.mergeable === 'CONFLICTING') return `#${pr.number} has merge conflicts with main; its author needs to update the branch.`;
    const failed = (pr.statusCheckRollup || []).filter((c) => FAILED_CHECKS.has(c.conclusion) || FAILED_CHECKS.has(c.state));
    if (failed.length) return `#${pr.number} has failing checks: ${failed.map((c) => c.name || c.context).join(', ')}.`;
    return null;
  }

  async mergePr(number, { method = 'merge' } = {}) {
    const n = prNumber(number);
    if (!MERGE_METHODS.includes(method)) throw new GitError(400, `Merge method must be one of: ${MERGE_METHODS.join(', ')}.`);
    const pr = JSON.parse(await this.gh('pr', 'view', String(n), '--json', MERGE_CHECK_FIELDS));
    const blocker = GitHubService.mergeBlocker(pr);
    if (blocker) throw new GitError(409, blocker);
    // Branches are kept (no --delete-branch): gh would also try to switch local checkouts.
    await this.gh('pr', 'merge', String(n), `--${method}`);
    return {
      number: n, title: pr.title, url: pr.url, method, branch: pr.headRefName, openedBy: openedBy(pr.body), main: await this.syncMain(),
    };
  }

  /** Best effort: bring the workspace's own main checkout up to date so new branches start fresh. */
  async syncMain() {
    try {
      await this.gitRemote(this.workspace, 'fetch', this.remoteUrl, '+refs/heads/main:refs/remotes/origin/main');
      const branch = (await this.git(this.workspace, 'rev-parse', '--abbrev-ref', 'HEAD')).trim();
      if (branch !== 'main') return 'workspace is not on main, left as is';
      await this.git(this.workspace, 'merge', '--ff-only', 'origin/main');
      return 'workspace main updated';
    } catch (err) {
      return `workspace main not updated (${err.message.split('\n')[0]})`;
    }
  }
}
