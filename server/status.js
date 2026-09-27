/**
 * Works out where an agent should be in the office from what its CLI is doing.
 *
 * Signals, strongest first:
 *   - git: unmerged paths in the agent's cwd            → conflict room
 *   - hooks (Claude Code hooks, Codex `notify`)         → question / working / break
 *   - terminal output heuristics (all CLIs)             → question / conflict / working
 *   - silence                                           → break room
 */

export const STATES = Object.freeze({
  OFFLINE: 'offline',
  WORKING: 'working',
  BREAK: 'break',
  QUESTION: 'question',
  CONFLICT: 'conflict',
});

// CSI, OSC (BEL or ST terminated), and two-char escapes.
const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;
const CONTROL_RE = /[\x00-\x08\x0b-\x1f\x7f]/g;

export function stripAnsi(text) {
  return String(text).replace(ANSI_RE, '').replace(CONTROL_RE, '');
}

const QUESTION_PATTERNS = [
  /do you want to [^\n?]{0,120}\?/i,
  /would you like [^\n?]{0,120}\?/i,
  /\b(allow|approve|run|execute|apply)\b[^\n?]{0,80}\?/i,
  /\btrust\b[^\n?]{0,80}\?/i,
  /\[(?:y\/n|y\/N|Y\/n)\]|\(y\/n\)/,
  /press enter to (?:confirm|continue)/i,
];

const CONFLICT_PATTERNS = [
  /CONFLICT \((?:content|add\/add|modify\/delete|rename\/delete|rename\/rename|file\/directory)\)/,
  /automatic merge failed/i,
  /(?<!no )merge conflicts?\b/i,
  /\bCONFLICTING\b/,
  /has conflicts that must be resolved/i,
  /^<{7} \S+/m,
];

const MAX_DETAIL = 160;
const RECENT_WINDOW = 1200;

function lineAround(text, index) {
  const start = text.lastIndexOf('\n', index) + 1;
  const endIdx = text.indexOf('\n', index);
  const line = text.slice(start, endIdx === -1 ? undefined : endIdx);
  return line.replace(/[│┃╭╮╰╯─━]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_DETAIL);
}

export function detectSignals(plainText) {
  let question = null;
  for (const re of QUESTION_PATTERNS) {
    const match = re.exec(plainText);
    if (match) {
      question = lineAround(plainText, match.index) || match[0];
      break;
    }
  }
  const conflict = CONFLICT_PATTERNS.some((re) => re.test(plainText));
  return { question, conflict };
}

const MAX_ACTIVITY = 36;

function basename(p) {
  return String(p || '').split('/').filter(Boolean).pop() || '';
}

function clip(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > MAX_ACTIVITY ? `${t.slice(0, MAX_ACTIVITY - 1)}…` : t;
}

/** A short, human line for what a tool call is doing (shown in thought bubbles). */
export function summarizeTool(payload = {}) {
  const tool = payload.tool_name || '';
  const input = payload.tool_input || {};
  switch (tool) {
    case 'Bash':
      return clip(`$ ${input.command || ''}`);
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      return clip(`✏️ ${basename(input.file_path || input.notebook_path)}`);
    case 'Read':
      return clip(`📖 ${basename(input.file_path)}`);
    case 'Grep':
    case 'Glob':
      return clip(`🔍 ${input.pattern || ''}`);
    case 'WebFetch':
    case 'WebSearch':
      return clip(`🌐 ${input.query || input.url || 'researching'}`);
    case 'Task':
    case 'Agent':
      return '👥 delegating';
    case 'TodoWrite':
      return '📝 planning';
    default:
      return tool ? clip(`🔧 ${tool}`) : '';
  }
}

function asText(value) {
  if (value == null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function endsWithQuestion(message) {
  const trimmed = asText(message).trim();
  return trimmed.endsWith('?') ? trimmed.slice(-MAX_DETAIL) : null;
}

export class StatusTracker {
  constructor({
    now = Date.now,
    idleMs = 6000,
    inputGraceMs = 1500,
    textConflictMs = 45_000,
    textConflicts = true,
    busyTtlMs = 15 * 60_000,
  } = {}) {
    this.now = now;
    this.idleMs = idleMs;
    this.inputGraceMs = inputGraceMs;
    this.textConflictMs = textConflictMs;
    this.textConflicts = textConflicts;
    this.busyTtlMs = busyTtlMs;
    this.running = false;
    this.reset();
    this.lastState = null;
    this.since = now();
  }

  reset() {
    this.lastActivity = 0;
    this.recent = '';
    this.question = null;
    this.screenQuestion = null;
    this.inputGraceUntil = 0;
    this.textConflictAt = 0;
    this.gitConflicts = [];
    this.busy = false;
    this.busyAt = 0;
    this.activity = '';
  }

  start() {
    this.reset();
    this.running = true;
    this.lastActivity = this.now();
  }

  exit() {
    this.running = false;
    this.reset();
  }

  /** Nudges the idle timer so the agent reads as idle shortly after a turn ends. */
  settleSoon() {
    this.busy = false;
    this.activity = '';
    this.lastActivity = Math.min(this.lastActivity, this.now() - this.idleMs + 1000);
  }

  output(chunk) {
    const plain = stripAnsi(chunk);
    if (!plain.trim()) return;
    const now = this.now();
    this.lastActivity = now;
    this.recent = (this.recent + plain).slice(-RECENT_WINDOW);
    if (now < this.inputGraceUntil) return;

    const signals = detectSignals(this.recent);
    if (signals.question) this.question = signals.question;
    if (signals.conflict && this.textConflicts) this.textConflictAt = now;
  }

  /**
   * Checks what is currently rendered on the agent's screen. TUIs position text
   * with cursor moves, so the raw stream often has no spaces to match against.
   */
  observeScreen(text) {
    if (this.now() < this.inputGraceUntil) {
      this.screenQuestion = null;
      return;
    }
    this.screenQuestion = detectSignals(String(text || '')).question;
  }

  input(data) {
    const now = this.now();
    this.question = null;
    this.screenQuestion = null;
    this.recent = '';
    this.inputGraceUntil = now + this.inputGraceMs;
    if (/[\r\n]/.test(data)) this.lastActivity = now;
  }

  hook(kind, payload = {}) {
    const now = this.now();
    switch (kind) {
      case 'prompt':
      case 'pretool':
      case 'posttool': {
        this.busy = true;
        this.busyAt = now;
        this.lastActivity = now;
        this.question = null;
        if (kind === 'pretool') this.activity = summarizeTool(payload);
        if (kind === 'pretool' && payload.tool_name === 'AskUserQuestion') {
          const first = payload.tool_input?.questions?.[0]?.question;
          this.question = asText(first || 'Has a question for you').slice(0, MAX_DETAIL);
        }
        if (kind === 'posttool' && this.textConflicts && detectSignals(asText(payload.tool_response)).conflict) {
          this.textConflictAt = now;
        }
        break;
      }
      case 'notification': {
        const message = asText(payload.message);
        const isIdle = payload.notification_type === 'idle_prompt' || /waiting for your input/i.test(message);
        if (isIdle) {
          this.settleSoon();
        } else {
          this.question = (message || 'Needs your attention').slice(0, MAX_DETAIL);
        }
        break;
      }
      case 'stop':
      case 'turn-complete': {
        this.settleSoon();
        const last = payload.last_assistant_message ?? payload['last-assistant-message'];
        const asked = endsWithQuestion(last);
        if (asked) this.question = asked;
        break;
      }
      default:
        break;
    }
  }

  setGitConflicts(files) {
    this.gitConflicts = Array.isArray(files) ? files.slice(0, 50) : [];
  }

  snapshot() {
    const now = this.now();
    if (!this.running) return { state: STATES.OFFLINE, detail: '' };

    if (this.gitConflicts.length) {
      return { state: STATES.CONFLICT, detail: `Unmerged: ${this.gitConflicts.join(', ')}`.slice(0, MAX_DETAIL) };
    }
    if (this.textConflictAt && now - this.textConflictAt < this.textConflictMs) {
      return { state: STATES.CONFLICT, detail: 'Spotted a merge conflict' };
    }
    const question = this.screenQuestion || this.question;
    if (question) return { state: STATES.QUESTION, detail: question };

    const busy = this.busy && now - this.busyAt < this.busyTtlMs;
    if (busy || now - this.lastActivity < this.idleMs) return { state: STATES.WORKING, detail: '', activity: this.activity };
    return { state: STATES.BREAK, detail: '' };
  }

  state() {
    return this.snapshot().state;
  }

  /** Returns the snapshot and whether state/detail changed since the last call. */
  evaluate() {
    const snap = this.snapshot();
    const key = `${snap.state}|${snap.detail}|${snap.activity || ''}`;
    const changed = key !== this.lastState;
    if (changed) {
      if (!this.lastState || !this.lastState.startsWith(`${snap.state}|`)) this.since = this.now();
      this.lastState = key;
    }
    return { changed, snapshot: { ...snap, since: this.since } };
  }
}
