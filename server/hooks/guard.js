#!/usr/bin/env node
/**
 * Claude Code PreToolUse hook: refuses Edit / Write / MultiEdit / NotebookEdit
 * on any file outside the office workspace (PLEXI_WORKSPACE). Fails closed —
 * if the payload or workspace can't be read, the edit is refused.
 * Shell commands are confined separately by Claude Code's Bash sandbox.
 */
import path from 'node:path';
import { isInsideWorkspace } from '../workspace.js';

// The CLIs' own config folders: editing them could loosen a sandbox.
const CONFIG_DIRS = ['.claude', '.codex', '.cursor'];

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const { PLEXI_WORKSPACE } = process.env;

function readStdin(timeoutMs) {
  return new Promise((resolve) => {
    let data = '';
    const timer = setTimeout(() => resolve(data), timeoutMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => { clearTimeout(timer); resolve(data); });
    process.stdin.on('error', () => { clearTimeout(timer); resolve(data); });
  });
}

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
  }));
}

async function main() {
  let payload;
  try {
    payload = JSON.parse(await readStdin(2000));
  } catch {
    return deny('Plexi Office could not read this edit request, so it was blocked.');
  }
  if (!EDIT_TOOLS.has(payload.tool_name)) return;
  const target = payload.tool_input?.file_path || payload.tool_input?.notebook_path;
  if (!PLEXI_WORKSPACE) return deny('Plexi Office workspace is not set, so edits are blocked.');
  if (!isInsideWorkspace(target, PLEXI_WORKSPACE, payload.cwd || PLEXI_WORKSPACE)) {
    return deny(`Plexi Office agents may only edit files inside ${PLEXI_WORKSPACE}. "${target}" is outside it.`);
  }
  const base = payload.cwd || PLEXI_WORKSPACE;
  if (CONFIG_DIRS.some((dir) => isInsideWorkspace(target, path.join(PLEXI_WORKSPACE, dir), base))) {
    deny(`Agent CLI settings (${CONFIG_DIRS.join(', ')}) in the workspace are for the manager only.`);
  }
}

main().catch(() => deny('Plexi Office edit guard failed, so the edit was blocked.')).finally(() => process.exit(0));
