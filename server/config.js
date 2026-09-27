import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(here, '..');
export const DATA_DIR = process.env.PLEXI_DATA_DIR || path.join(ROOT_DIR, 'data');
export const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
export const NOTIFY_SCRIPT = path.join(here, 'hooks', 'notify.js');
export const GUARD_SCRIPT = path.join(here, 'hooks', 'guard.js');

export const HOST = '127.0.0.1';
export const PORT = Number(process.env.PLEXI_PORT) || 4777;
// Agents work here unless told otherwise. Not the home folder: Claude Code never
// remembers "trust this folder" for ~, so agents there would ask on every launch.
export const DEFAULT_CWD = process.env.PLEXI_DEFAULT_CWD || path.join(os.homedir(), 'plexi-workspace');
// Agents may only change files inside DEFAULT_CWD, a clone of this repo.
export const WORKSPACE_REPO = 'https://github.com/ririversoza/plexi-workspace';

/** Max bytes of terminal output kept per session for replay on re-attach. */
export const SCROLLBACK_BYTES = 256 * 1024;
export const GIT_POLL_MS = 4000;
export const STATUS_TICK_MS = 1000;

/**
 * Agent teams. `install` is a fixed, allow-listed command — user input never
 * reaches it. Commands are the vendors' documented installers.
 */
export const AGENT_TYPES = Object.freeze({
  claude: {
    label: 'Claude Code',
    team: 'Team Claude',
    bin: 'claude',
    install: 'curl -fsSL https://claude.ai/install.sh | bash',
    docs: 'https://docs.claude.com/en/docs/claude-code/setup',
  },
  codex: {
    label: 'Codex CLI',
    team: 'Team Codex',
    bin: 'codex',
    install: 'npm install -g @openai/codex',
    docs: 'https://github.com/openai/codex',
  },
  cursor: {
    label: 'Cursor Agent',
    team: 'Team Cursor',
    bin: 'cursor-agent',
    install: 'curl https://cursor.com/install -fsS | bash',
    docs: 'https://cursor.com/cli',
  },
});

export const MAX_AGENTS_PER_TYPE = 12;

/** Office staff: always present, sit at their own desks, run Claude Code. */
export const STAFF = Object.freeze([
  { role: 'assistant', name: 'Juniper', type: 'claude', personality: 'organizer' },
  { role: 'hr', name: 'Poppy', type: 'claude', personality: 'peopleperson' },
]);

/** Supermemory Local — long-term memory for every agent. */
export const SUPERMEMORY = Object.freeze({
  label: 'Supermemory Local',
  bin: 'supermemory-server',
  install: 'curl -fsSL https://supermemory.ai/install | bash',
  docs: 'https://github.com/supermemoryai/supermemory#supermemory-local--run-it-yourself',
  dataDir: path.join(DATA_DIR, 'supermemory'),
});

/** Auto-save each finished agent turn into that agent's memory (PLEXI_AUTO_MEMORY=0 to disable). */
export const AUTO_MEMORY = process.env.PLEXI_AUTO_MEMORY !== '0';
export const BIN_DIR = path.join(here, 'bin');

export const DEFAULT_ROSTER = [
  { name: 'Mochi', type: 'claude' },
  { name: 'Sora', type: 'claude' },
  { name: 'Pip', type: 'claude' },
  { name: 'Kiwi', type: 'codex' },
  { name: 'Bao', type: 'codex' },
  { name: 'Nori', type: 'cursor' },
  { name: 'Taro', type: 'cursor' },
];
