import { ValidationError } from './store.js';

/**
 * Office-wide agent permissions, applied when an agent's CLI launches.
 *  - Claude Code: `permissions` in the --settings JSON (merged with your own settings;
 *    deny rules always win). Anything not allowed still prompts → the agent walks to you.
 *  - Codex: --sandbox / --ask-for-approval.
 *  - Cursor Agent: no permission flags beyond its sandbox.
 * Whatever the preset, launch.js keeps every agent's writes inside the workspace.
 * Stored in data/settings.json as
 * { preset: 'cli'|'safe'|'custom', acceptEdits, allow: [], deny: [], codexSandbox, codexApproval }.
 */
const PRESETS = ['cli', 'safe', 'custom'];
// No 'danger-full-access': agents may only write inside the office workspace.
const CODEX_SANDBOXES = ['read-only', 'workspace-write'];
const CODEX_APPROVALS = ['on-request', 'never'];
const RULE_RE = /^[A-Za-z][A-Za-z0-9_]*(\([^\n()]{1,200}\))?$/;
const MAX_RULES = 100;

/** Reading, searching, the office helper, read-only git, and test/lint/build commands. */
export const SAFE_ALLOW = Object.freeze([
  'Read', 'Glob', 'Grep', 'LS',
  'Bash(plexi *)', 'Bash(pwd)', 'Bash(ls *)',
  'Bash(git status)', 'Bash(git status *)', 'Bash(git diff)', 'Bash(git diff *)', 'Bash(git log *)', 'Bash(git show *)', 'Bash(git branch)',
  'Bash(npm test)', 'Bash(npm test *)', 'Bash(npm run test *)', 'Bash(npm run lint *)', 'Bash(npm run build *)', 'Bash(npm run typecheck *)',
  'Bash(node --test *)', 'Bash(npx tsc *)', 'Bash(pytest *)', 'Bash(go test *)', 'Bash(cargo test *)',
]);

/** Never, even if asked: destructive shell commands and secrets. */
export const SAFE_DENY = Object.freeze([
  'Bash(rm -rf *)', 'Bash(sudo *)', 'Bash(git reset --hard *)', 'Bash(git clean -fd *)',
  'Read(./.env)', 'Read(./.env.*)', 'Read(~/.ssh/**)', 'Read(~/.aws/**)',
]);

export const DEFAULT_PERMISSIONS = Object.freeze({
  preset: 'safe',
  acceptEdits: true,
  allow: [...SAFE_ALLOW],
  deny: [...SAFE_DENY],
  codexSandbox: 'workspace-write',
  codexApproval: 'on-request',
});

function rules(list, label) {
  if (list === undefined) return undefined;
  if (!Array.isArray(list) || list.length > MAX_RULES) throw new ValidationError(`${label} must be a list of up to ${MAX_RULES} rules.`);
  return list.map((r) => String(r).trim()).filter(Boolean).map((r) => {
    if (!RULE_RE.test(r)) throw new ValidationError(`"${r}" is not a permission rule like Bash(npm test *) or Read.`);
    return r;
  });
}

function oneOf(value, allowed, label) {
  if (value === undefined) return undefined;
  if (!allowed.includes(value)) throw new ValidationError(`${label} must be one of: ${allowed.join(', ')}.`);
  return value;
}

export function sanitizePermissions(input = {}, current = DEFAULT_PERMISSIONS) {
  if (!input || typeof input !== 'object') throw new ValidationError('Permissions must be an object.');
  const next = {
    preset: oneOf(input.preset, PRESETS, 'preset'),
    acceptEdits: input.acceptEdits === undefined ? undefined : Boolean(input.acceptEdits),
    allow: rules(input.allow, 'Allow'),
    deny: rules(input.deny, 'Deny'),
    codexSandbox: oneOf(input.codexSandbox, CODEX_SANDBOXES, 'Codex sandbox'),
    codexApproval: oneOf(input.codexApproval, CODEX_APPROVALS, 'Codex approval'),
  };
  return Object.fromEntries(Object.entries({ ...DEFAULT_PERMISSIONS, ...current }).map(([k, v]) => [k, next[k] === undefined ? v : next[k]]));
}

/** What to pass to each CLI; null means "leave that CLI's defaults alone". */
export function resolvePermissions(perms = DEFAULT_PERMISSIONS) {
  const p = { ...DEFAULT_PERMISSIONS, ...perms };
  if (p.preset === 'cli') return { claude: null, codex: null };
  const safe = p.preset === 'safe';
  return {
    claude: {
      ...(p.acceptEdits && { defaultMode: 'acceptEdits' }),
      allow: safe ? [...SAFE_ALLOW] : p.allow,
      deny: safe ? [...SAFE_DENY] : p.deny,
    },
    codex: {
      sandbox: safe || !CODEX_SANDBOXES.includes(p.codexSandbox) ? 'workspace-write' : p.codexSandbox,
      approval: safe ? 'on-request' : p.codexApproval,
    },
  };
}
