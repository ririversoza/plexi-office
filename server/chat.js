import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './config.js';
import { ValidationError } from './store.js';

/**
 * The office group chat: one channel for agents and the manager.
 * Persisted to data/chat.json as
 * { messages: [{ id, at, from, name, text, mentions: [agentId | 'all'] }], read: { readerId: at }, nudged: { readerId: at } }.
 * `read` is what someone has seen with `plexi chat read`; `nudged` is how far the
 * mid-work hook has delivered @mentions and manager messages to them.
 */
const FILE = path.join(DATA_DIR, 'chat.json');
export const MANAGER_ID = 'manager';
const MAX_MESSAGES = 500;
export const MAX_TEXT = 500;
export const COOLDOWN_MS = 8000;
const SAVE_DEBOUNCE_MS = 1000;
const MENTION_RE = /@([\p{L}\p{N}_.-]+)/gu;
const EVERYONE = new Set(['all', 'everyone', 'here', 'team']);

export class ChatStore {
  constructor(file = FILE, { now = Date.now, maxText = MAX_TEXT, cooldownMs = COOLDOWN_MS } = {}) {
    this.file = file;
    this.now = now;
    this.maxText = maxText;
    this.cooldownMs = cooldownMs;
    this.messages = [];
    this.read = {};
    this.nudged = {};
    this.saveTimer = null;
  }

  load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.messages = data.messages || [];
      this.read = data.read || {};
      this.nudged = data.nudged || {};
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn(`[chat] could not read ${this.file}: ${err.message}`);
    }
    return this;
  }

  /**
   * @param agents [{ id, name }] — who can be @mentioned.
   * @param to extra recipients (agent ids) and `meta` extra fields, e.g. for reports.
   */
  post({ from, name, text, agents = [], to = [], meta = {} }) {
    const clean = String(text ?? '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
    if (!clean) throw new ValidationError('The message is empty.');
    if (clean.length > this.maxText) throw new ValidationError(`Keep it under ${this.maxText} characters.`);
    const now = this.now();
    if (from !== MANAGER_ID) {
      const last = this.messages.findLast((m) => m.from === from);
      if (last && now - last.at < this.cooldownMs) throw new ValidationError('Slow down a little; one message every few seconds.');
    }
    const byName = new Map(agents.map((a) => [a.name.toLowerCase(), a.id]));
    const mentions = new Set(to);
    for (const [, handle] of clean.matchAll(MENTION_RE)) {
      const key = handle.toLowerCase().replace(/[.\-_]+$/, '');
      if (EVERYONE.has(key)) mentions.add('all');
      else if (byName.has(key)) mentions.add(byName.get(key));
    }
    const message = { id: `m_${crypto.randomBytes(5).toString('hex')}`, at: now, from, name, text: clean, mentions: [...mentions], ...meta };
    this.messages = [...this.messages, message].slice(-MAX_MESSAGES);
    this.read = { ...this.read, [from]: now };
    this.scheduleSave();
    return message;
  }

  recent(limit = 30) {
    return this.messages.slice(-Math.max(1, Math.min(100, limit)));
  }

  unreadCount(readerId) {
    const since = this.read[readerId] || 0;
    return this.messages.filter((m) => m.at > since && m.from !== readerId).length;
  }

  /** What they haven't read yet (up to `limit`), then marks everything read. */
  readFor(readerId, limit = 30) {
    const since = this.read[readerId] || 0;
    const unread = this.messages.filter((m) => m.at > since && m.from !== readerId);
    const shown = unread.length ? unread.slice(-limit) : this.recent(Math.min(limit, 10));
    this.read = { ...this.read, [readerId]: this.now() };
    this.nudged = { ...this.nudged, [readerId]: this.now() };
    this.scheduleSave();
    return { messages: shown, unread: unread.length };
  }

  /** New messages that should reach them mid-work: @mentions of them or everyone, and anything from the manager. */
  nudgesFor(readerId) {
    const important = this.peekNudges(readerId);
    if (important.length) {
      this.nudged = { ...this.nudged, [readerId]: important.at(-1).at };
      this.scheduleSave();
    }
    return { messages: important, unread: this.unreadCount(readerId) };
  }

  /** Same as nudgesFor, without marking anything delivered. */
  peekNudges(readerId) {
    const since = Math.max(this.nudged[readerId] || 0, this.read[readerId] || 0);
    return this.messages.filter((m) => m.at > since && m.from !== readerId
      && (m.from === MANAGER_ID || m.mentions.includes(readerId) || m.mentions.includes('all')));
  }

  removeAgent(id) {
    this.messages = this.messages.map((m) => ({ ...m, mentions: m.mentions.filter((x) => x !== id) }));
    const { [id]: _r, ...read } = this.read;
    const { [id]: _n, ...nudged } = this.nudged;
    this.read = read;
    this.nudged = nudged;
    this.scheduleSave();
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), SAVE_DEBOUNCE_MS);
    this.saveTimer.unref?.();
  }

  flush() {
    clearTimeout(this.saveTimer);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ messages: this.messages, read: this.read, nudged: this.nudged }, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
