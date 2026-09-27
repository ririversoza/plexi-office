import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AGENT_TYPES } from './config.js';

const run = promisify(execFile);
const home = os.homedir();

// Where the vendor installers drop binaries, in case the login shell PATH misses them.
const EXTRA_DIRS = [
  path.join(home, '.local', 'bin'),
  path.join(home, '.claude', 'local'),
  path.join(home, '.bun', 'bin'),
  path.join(home, '.supermemory', 'bin'),
  path.join(home, '.npm-global', 'bin'),
  path.join(home, '.volta', 'bin'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
];

let cachedPath = null;

/** PATH as the user's login shell sees it, plus known installer locations. */
export async function resolvePath({ refresh = false } = {}) {
  if (cachedPath && !refresh) return cachedPath;
  let loginPath = '';
  const shell = process.env.SHELL || '/bin/zsh';
  try {
    const { stdout } = await run(shell, ['-lc', 'printf %s "$PATH"'], { timeout: 4000 });
    loginPath = stdout.trim();
  } catch (err) {
    console.warn(`[clis] could not read login shell PATH (${err.message}); using process PATH`);
  }
  const dirs = [...loginPath.split(':'), ...(process.env.PATH || '').split(':'), ...EXTRA_DIRS];
  cachedPath = [...new Set(dirs.filter(Boolean))].join(':');
  return cachedPath;
}

export function findExecutable(bin, pathEnv) {
  for (const dir of pathEnv.split(':')) {
    const candidate = path.join(dir, bin);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // not in this dir
    }
  }
  return null;
}

/** @returns {Promise<Record<string, {installed: boolean, path: string|null, label: string, install: string}>>} */
export async function detectClis({ refresh = false } = {}) {
  const pathEnv = await resolvePath({ refresh });
  return Object.fromEntries(
    Object.entries(AGENT_TYPES).map(([type, def]) => {
      const found = findExecutable(def.bin, pathEnv);
      return [type, { installed: Boolean(found), path: found, label: def.label, bin: def.bin, install: def.install, docs: def.docs }];
    }),
  );
}

/** Lists unmerged (conflicted) paths in a git work tree; [] when clean or not a repo. */
export async function gitConflicts(cwd) {
  try {
    const { stdout } = await run('git', ['-C', cwd, 'diff', '--name-only', '--diff-filter=U'], { timeout: 3000 });
    return stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}
