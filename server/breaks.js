import { ValidationError } from './store.js';

/**
 * Scheduled breaks: after `workMinutes` of cumulative work, an agent's next
 * natural pause becomes a `breakMinutes` break (shown as "Scheduled break").
 *
 * We never freeze a CLI mid-task (suspending the process could break its API
 * stream), so the break starts when the agent goes idle. Real work, questions
 * and conflicts always win over the break.
 */
export const DEFAULT_BREAKS = Object.freeze({ enabled: true, workMinutes: 15, breakMinutes: 3 });
const MINUTE = 60_000;
const MAX_TICK_MS = 5000; // ignore long gaps (e.g. laptop sleep) when counting work

function validMinutes(value, min, max, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new ValidationError(`${label} must be between ${min} and ${max} minutes.`);
  return Math.round(n);
}

export class BreakScheduler {
  constructor({ now = Date.now, config = DEFAULT_BREAKS } = {}) {
    this.now = now;
    this.config = { ...DEFAULT_BREAKS, ...config };
    this.agents = new Map();
  }

  configure(changes = {}) {
    this.config = {
      enabled: changes.enabled === undefined ? this.config.enabled : Boolean(changes.enabled),
      workMinutes: changes.workMinutes === undefined ? this.config.workMinutes : validMinutes(changes.workMinutes, 1, 240, 'Work time'),
      breakMinutes: changes.breakMinutes === undefined ? this.config.breakMinutes : validMinutes(changes.breakMinutes, 1, 60, 'Break time'),
    };
    return this.config;
  }

  forget(id) {
    this.agents.delete(id);
  }

  stateFor(id) {
    let s = this.agents.get(id);
    if (!s) {
      s = { workedMs: 0, lastAt: this.now(), breakUntil: 0 };
      this.agents.set(id, s);
    }
    return s;
  }

  /** Takes a raw status snapshot and returns what the office should show. */
  apply(id, snap) {
    const s = this.stateFor(id);
    const now = this.now();
    const elapsed = Math.min(Math.max(0, now - s.lastAt), MAX_TICK_MS);
    s.lastAt = now;

    if (snap.state === 'offline') {
      s.workedMs = 0;
      s.breakUntil = 0;
      return snap;
    }
    if (!this.config.enabled) return snap;

    if (s.breakUntil > now) {
      if (snap.state === 'working') {
        s.breakUntil = 0;
        s.workedMs = 0;
        return snap;
      }
      return snap.state === 'break' ? this.scheduled(snap, s) : snap;
    }
    s.breakUntil = 0;

    if (snap.state === 'working') {
      s.workedMs += elapsed;
      return snap;
    }
    if (snap.state === 'break' && s.workedMs >= this.config.workMinutes * MINUTE) {
      s.workedMs = 0;
      s.breakUntil = now + this.config.breakMinutes * MINUTE;
      return this.scheduled(snap, s);
    }
    return snap;
  }

  scheduled(snap, s) {
    return { ...snap, detail: `Scheduled break ☕ (${this.config.breakMinutes} min)`, breakEndsAt: s.breakUntil };
  }
}
