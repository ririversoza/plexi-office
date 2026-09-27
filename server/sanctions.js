import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './config.js';
import { ValidationError } from './store.js';

/**
 * HR's disciplinary record. Persisted to data/sanctions.json as
 * { records: [{ id, agentId, level: 'warning'|'suspension', reason, by, at, until, liftedAt?, liftedBy? }] }.
 *  - warning: on the agent's record for WARNING_DAYS; they're told why.
 *  - suspension: clocked out and can't be started or assigned until `until`.
 *    Only possible while a warning is active, so HR escalates instead of jumping straight to it.
 */
const FILE = path.join(DATA_DIR, 'sanctions.json');
export const LEVELS = Object.freeze(['warning', 'suspension']);
const WARNING_DAYS = 7;
export const SUSPENSION_MINUTES = Object.freeze({ min: 5, max: 240, default: 30 });
const REASON = { min: 10, max: 300 };
const COOLDOWN_MS = 5 * 60_000;
const MAX_RECORDS = 500;
const DAY_MS = 86_400_000;

export class SanctionStore {
  constructor(file = FILE, { now = Date.now } = {}) {
    this.file = file;
    this.now = now;
    this.records = [];
  }

  load() {
    try {
      this.records = JSON.parse(fs.readFileSync(this.file, 'utf8')).records || [];
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn(`[sanctions] could not read ${this.file}: ${err.message}`);
      this.records = [];
    }
    return this;
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ records: this.records }, null, 2));
    fs.renameSync(tmp, this.file);
  }

  isActive(r, now = this.now()) {
    return !r.liftedAt && r.until > now;
  }

  active(agentId) {
    const now = this.now();
    return this.records.filter((r) => r.agentId === agentId && this.isActive(r, now));
  }

  /** The one that matters most right now: a suspension outranks a warning. */
  current(agentId) {
    const list = this.active(agentId);
    const pick = list.find((r) => r.level === 'suspension') || list[0];
    return pick ? { id: pick.id, level: pick.level, reason: pick.reason, by: pick.by, at: pick.at, until: pick.until } : null;
  }

  suspension(agentId) {
    return this.active(agentId).find((r) => r.level === 'suspension') || null;
  }

  history(agentId, limit = 20) {
    return this.records.filter((r) => r.agentId === agentId).slice(-limit).reverse();
  }

  issue({ agent, level, reason, minutes, by }) {
    if (!agent || agent.role !== 'worker') throw new ValidationError('Only coding agents can be sanctioned; staff answer to the manager.');
    if (!LEVELS.includes(level)) throw new ValidationError(`Level must be one of: ${LEVELS.join(', ')}.`);
    const text = String(reason || '').replace(/\s+/g, ' ').trim();
    if (text.length < REASON.min) throw new ValidationError('Give a concrete reason: what they did, and where (a file, PR or commit).');
    const now = this.now();
    const recent = this.records.find((r) => r.agentId === agent.id && now - r.at < COOLDOWN_MS);
    if (recent) throw new ValidationError(`${agent.name} was just sanctioned; give it a few minutes before another.`);
    let until = now + WARNING_DAYS * DAY_MS;
    if (level === 'suspension') {
      if (this.suspension(agent.id)) throw new ValidationError(`${agent.name} is already suspended.`);
      if (!this.active(agent.id).some((r) => r.level === 'warning')) {
        throw new ValidationError(`${agent.name} has no active warning. Start with a warning; suspend only if it happens again.`);
      }
      const m = minutes === undefined ? SUSPENSION_MINUTES.default : Number(minutes);
      if (!Number.isInteger(m) || m < SUSPENSION_MINUTES.min || m > SUSPENSION_MINUTES.max) {
        throw new ValidationError(`A suspension lasts ${SUSPENSION_MINUTES.min}–${SUSPENSION_MINUTES.max} minutes.`);
      }
      until = now + m * 60_000;
    }
    const record = {
      id: `s_${crypto.randomBytes(4).toString('hex')}`, agentId: agent.id, level, reason: text.slice(0, REASON.max), by, at: now, until,
    };
    this.records = [...this.records, record].slice(-MAX_RECORDS);
    this.save();
    return record;
  }

  /** Lifts one record (by id) or everything active for an agent (by agentId). */
  lift({ id, agentId, by }) {
    const now = this.now();
    let lifted = [];
    this.records = this.records.map((r) => {
      const match = id ? r.id === id : r.agentId === agentId;
      if (!match || !this.isActive(r, now)) return r;
      const done = { ...r, liftedAt: now, liftedBy: by };
      lifted = [...lifted, done];
      return done;
    });
    if (lifted.length) this.save();
    return lifted;
  }

  removeAgent(agentId) {
    this.records = this.records.filter((r) => r.agentId !== agentId);
    this.save();
  }
}
