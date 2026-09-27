import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './config.js';

/**
 * The Office Feed: break-room conversations and relationship changes ("gossip").
 * Newest first, capped, persisted to data/feed.json:
 * { entries: [{ id, at, type: 'chat'|'gossip', a, b, room?, kind?, lines?: [{ who, text }], label?, prevLabel? }] }
 */
const FILE = path.join(DATA_DIR, 'feed.json');
const DEFAULT_LIMIT = 300;
const MAX_LINES = 8;
const MAX_LINE_CHARS = 160;
const SAVE_DEBOUNCE_MS = 1500;

export function sanitizeLines(lines) {
  if (!Array.isArray(lines)) return [];
  return lines
    .filter((l) => l && typeof l === 'object' && (l.who === 0 || l.who === 1) && typeof l.text === 'string')
    .slice(0, MAX_LINES)
    .map((l) => ({ who: l.who, text: l.text.slice(0, MAX_LINE_CHARS) }));
}

export class Feed {
  constructor(file = FILE, { limit = DEFAULT_LIMIT, now = Date.now } = {}) {
    this.file = file;
    this.limit = limit;
    this.now = now;
    this.entries = [];
    this.saveTimer = null;
  }

  load() {
    try {
      this.entries = JSON.parse(fs.readFileSync(this.file, 'utf8')).entries || [];
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn(`[feed] could not read ${this.file}: ${err.message}`);
      this.entries = [];
    }
    return this;
  }

  add(entry) {
    const full = { id: `f_${crypto.randomBytes(5).toString('hex')}`, at: this.now(), ...entry };
    this.entries = [full, ...this.entries].slice(0, this.limit);
    this.scheduleSave();
    return full;
  }

  list(limit = this.limit) {
    return this.entries.slice(0, limit);
  }

  removeAgent(id) {
    this.entries = this.entries.filter((e) => e.a !== id && e.b !== id);
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
    fs.writeFileSync(tmp, JSON.stringify({ entries: this.entries }, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
