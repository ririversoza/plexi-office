import path from 'node:path';
import { BIN_DIR, DEFAULT_CWD, GUARD_SCRIPT, NOTIFY_SCRIPT } from './config.js';

const PLEXI_BIN = path.join(BIN_DIR, 'plexi.mjs');

// Env vars that make a nested `claude` think it is running inside another session.
const STRIPPED_ENV = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT'];

/**
 * Git for agents: commits are unsigned (your signing key needs a passphrase and sits in
 * ~/.ssh, which their sandboxes can't read) and made under the agent's own name, not yours.
 * Set through the environment, so only agent processes are affected: your own commits,
 * signing and git config stay exactly as they are.
 */
export function agentGitEnv(agent) {
  const handle = String(agent.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agent';
  const name = `${agent.name} (Plexi agent)`;
  const email = `${handle}@agents.plexi.invalid`;
  return {
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email,
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'commit.gpgsign',
    GIT_CONFIG_VALUE_0: 'false',
    GIT_CONFIG_KEY_1: 'tag.gpgsign',
    GIT_CONFIG_VALUE_1: 'false',
  };
}

function shellQuote(value) {
  return `"${String(value).replace(/(["\\$`])/g, '\\$1')}"`;
}

function command(...parts) {
  return parts.map(shellQuote).join(' ');
}

/**
 * Claude Code settings layered on via --settings:
 *  - status hooks report to the office (notify.js, silent)
 *  - SessionStart / UserPromptSubmit recall hooks print Supermemory context,
 *    which Claude Code adds to the conversation.
 *  - the workspace lock: guard.js refuses file edits outside the workspace, and the
 *    Bash sandbox (macOS Seatbelt) keeps shell writes inside it too. No unsandboxed
 *    retries; network goes to the office helper and GitHub, anything else prompts.
 *  - `plexi` stays sandboxed: Node's fetch ignores the sandbox proxy, so localhost is
 *    opened directly (allowLocalBinding). An exclusion wouldn't do: it only matches a
 *    command on its own, not `plexi status; ls`.
 *  - nothing runs unsandboxed: agents push, fetch and open PRs with `plexi push`,
 *    `plexi fetch` and `plexi pr create`, which the office runs for them (github.js).
 */
export const SANDBOX_EXCLUDED = Object.freeze([]);

export const WORKSPACE_SANDBOX = Object.freeze({
  enabled: true,
  allowUnsandboxedCommands: false,
  excludedCommands: [...SANDBOX_EXCLUDED],
  // Another CLI's sandbox config lives here; see workspace.js.
  filesystem: { denyWrite: [path.join(DEFAULT_CWD, '.cursor'), path.join(DEFAULT_CWD, '.codex')] },
  network: { allowLocalBinding: true, allowedDomains: ['localhost', '127.0.0.1', 'github.com', '*.github.com', 'registry.npmjs.org'] },
});

export function claudeHookSettings(nodePath, { memory = true, permissions = null, reportsInbox = false } = {}) {
  const notify = (kind) => ({ type: 'command', command: command(nodePath, NOTIFY_SCRIPT, kind), timeout: 5 });
  const guard = { type: 'command', command: command(nodePath, GUARD_SCRIPT), timeout: 5 };
  const recall = (...args) => ({ type: 'command', command: command(nodePath, PLEXI_BIN, 'recall', ...args), timeout: 10 });
  // Group chat: @mentions and manager messages, delivered between tool calls and with each prompt.
  const chatNudge = (when) => ({ type: 'command', command: command(nodePath, PLEXI_BIN, 'chat', 'nudge', '--hook', when), timeout: 5 });
  // The Assistant Manager also hears about agents' reports as they come in.
  const nudges = (when) => [chatNudge(when), ...(reportsInbox ? [{ type: 'command', command: command(nodePath, PLEXI_BIN, 'reports', 'nudge', '--hook', when), timeout: 5 }] : [])];
  return {
    ...(permissions && { permissions }),
    sandbox: WORKSPACE_SANDBOX,
    hooks: {
      ...(memory && { SessionStart: [{ hooks: [recall('--session')] }] }),
      UserPromptSubmit: [{ hooks: [notify('prompt'), ...(memory ? [recall()] : []), ...nudges('prompt')] }],
      PreToolUse: [
        { matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [guard] },
        { matcher: '*', hooks: [notify('pretool')] },
      ],
      PostToolUse: [{ matcher: '*', hooks: [notify('posttool'), ...nudges('post')] }],
      Notification: [{ hooks: [notify('notification')] }],
      Stop: [{ hooks: [notify('stop')] }],
    },
  };
}

function argsFor(agent, { nodePath, persona, memory, permissions }) {
  switch (agent.type) {
    case 'claude':
      return [
        '--settings', JSON.stringify(claudeHookSettings(nodePath, { memory, permissions: permissions?.claude, reportsInbox: agent.role === 'assistant' })),
        // Only your own ~/.claude settings plus ours: a settings file an agent wrote into
        // the workspace can't widen the sandbox or permissions.
        '--setting-sources', 'user',
        '--name', agent.name,
        ...(persona ? ['--append-system-prompt', persona] : []),
      ];
    case 'codex':
      return [
        // Codex appends its JSON payload as the final argv entry.
        '-c', `notify=${JSON.stringify([nodePath, NOTIFY_SCRIPT, 'turn-complete'])}`,
        // JSON string literals are valid TOML basic strings.
        ...(persona ? ['-c', `developer_instructions=${JSON.stringify(persona)}`] : []),
        // Always sandboxed: writes stay inside the workspace (its cwd). Network is on so
        // `plexi` can reach the office; extra writable roots are pinned to none, so a
        // .codex/config.toml in the workspace can't add any.
        '--sandbox', permissions?.codex?.sandbox || 'workspace-write',
        '-c', 'sandbox_workspace_write.network_access=true',
        '-c', 'sandbox_workspace_write.writable_roots=[]',
        ...(permissions?.codex ? ['--ask-for-approval', permissions.codex.approval] : []),
      ];
    default:
      // cursor-agent has no documented system-prompt flag; its personality shows
      // in the office and via `plexi whoami`. Its sandbox keeps writes in the workspace.
      return ['--sandbox', 'enabled', '--workspace', agent.cwd];
  }
}

/**
 * Builds the pty spawn spec for an agent's CLI.
 * @returns {{file: string, args: string[], env: Record<string,string>}}
 */
export function buildLaunch(agent, {
  binPath, nodePath = process.execPath, pathEnv, url, token, persona = '', memory = true, permissions = null, baseEnv = process.env,
}) {
  const env = { ...baseEnv };
  for (const key of STRIPPED_ENV) delete env[key];
  return {
    file: binPath,
    args: argsFor(agent, { nodePath, persona, memory, permissions }),
    env: {
      ...env,
      PATH: [BIN_DIR, pathEnv, path.dirname(nodePath)].join(':'),
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      PLEXI_AGENT_ID: agent.id,
      PLEXI_AGENT_NAME: agent.name,
      PLEXI_URL: url,
      PLEXI_TOKEN: token,
      PLEXI_WORKSPACE: DEFAULT_CWD,
      ...agentGitEnv(agent),
    },
  };
}

/** Spawn spec for a vendor installer, run through the login shell so PATH/npm resolve. */
export function buildInstall(installCommand, { pathEnv, baseEnv = process.env }) {
  const shell = baseEnv.SHELL || '/bin/zsh';
  const banner = `printf '\\033[1;35m[plexi]\\033[0m running: %s\\r\\n\\r\\n' ${shellQuote(installCommand)}`;
  return {
    file: shell,
    args: ['-lc', `${banner}; ${installCommand}`],
    env: { ...baseEnv, PATH: pathEnv, TERM: 'xterm-256color' },
  };
}
