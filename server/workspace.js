import fs from 'node:fs';
import path from 'node:path';

/**
 * The one folder agents may change: a clone of the office's shared repo.
 * Symlinks are resolved first, so a link inside the workspace that points
 * elsewhere does not count as inside.
 */
function realish(target) {
  // Resolve the nearest part of the path that exists; keep the rest as written.
  let existing = path.resolve(target);
  const rest = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    rest.unshift(path.basename(existing));
    existing = parent;
  }
  let real = existing;
  try {
    real = fs.realpathSync(existing);
  } catch {
    // unreadable: compare as written
  }
  return path.join(real, ...rest);
}

/** True when `target` (absolute, or relative to `base`) is the workspace or inside it. */
export function isInsideWorkspace(target, root, base = root) {
  if (!target || !root) return false;
  const rootReal = realish(root);
  const targetReal = realish(path.resolve(base, String(target)));
  const rel = path.relative(rootReal, targetReal);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Files inside the workspace that would loosen another CLI's sandbox if an agent
 * wrote them. Cursor merges a repo's .cursor/sandbox.json (extra writable paths,
 * network) into its sandbox on every command; Cursor's own shell can't write it,
 * but a Codex agent could. Claude ignores repo settings (--setting-sources user)
 * and Codex has its writable roots pinned, so only this one needs watching.
 */
export const SANDBOX_POLICY_FILES = Object.freeze([path.join('.cursor', 'sandbox.json')]);

/** Moves any such file aside (never deletes it) and returns what was moved. */
export function quarantinePolicyFiles(root, now = Date.now()) {
  const moved = [];
  for (const rel of SANDBOX_POLICY_FILES) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) continue;
    const aside = `${file}.rejected-${now}`;
    fs.renameSync(file, aside);
    moved.push({ file, aside });
  }
  return moved;
}
