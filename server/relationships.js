import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './config.js';
import { compatibility } from './personality.js';

/**
 * Relationships between agents. Each pair has an affinity (-100 enemies … 100
 * best friends) and a romance score (0 … 100) that grows only between good
 * friends with chemistry. The server owns the maths; browsers just report
 * what happened ("they chatted", "they argued").
 * Love triangles: when an agent already crushing on (or dating) someone starts a new crush,
 * the one left behind cools on them and becomes rivals with the new crush.
 * Persisted to data/relationships.json: { pairs: { "a_1|a_2": { affinity, romance, interactions, updatedAt } } }
 */
const FILE = path.join(DATA_DIR, 'relationships.json');
const PAIR_COOLDOWN_MS = 10_000;
const SAVE_DEBOUNCE_MS = 1500;
const RANDOM_SWING = 3;
const COMPAT_WEIGHT = 4;
const SAME_TEAM_BONUS = 1;
const ROMANCE_MIN_AFFINITY = 45;
const ROMANCE_MIN_CHEMISTRY = 0.55;
// Jealousy: when an agent with a crush (or sweetheart) develops a new crush, the one left behind sours.
const JILTED_AFFINITY_HIT = 20;
const JILTED_ROMANCE_HIT = 40;
const RIVAL_AFFINITY_HIT = 20;
const RIVAL_AFFINITY_CAP = -30; // at or below the rivals threshold
const ROMANTIC = new Set(['crush', 'sweethearts']);

export const INTERACTIONS = Object.freeze({ chat: 3, joke: 5, highfive: 7, makeup: 4, argue: -7 });
/** Work events the server records itself (browsers can't report these). */
const WORK_INTERACTIONS = Object.freeze({ teamwork: 3, sanction: -15 });
const ALL_INTERACTIONS = Object.freeze({ ...INTERACTIONS, ...WORK_INTERACTIONS });
/** How a group chat post to someone lands, by the vibe its author gave it. */
export const CHAT_VIBES = Object.freeze({ friendly: 'chat', joke: 'joke', thanks: 'highfive', snipe: 'argue' });

const LABELS = {
  sweethearts: { key: 'sweethearts', label: 'Sweethearts', emoji: '💕' },
  crush: { key: 'crush', label: 'Crushing', emoji: '💗' },
  bestfriends: { key: 'bestfriends', label: 'Best friends', emoji: '💛' },
  friends: { key: 'friends', label: 'Friends', emoji: '🤝' },
  coworkers: { key: 'coworkers', label: 'Coworkers', emoji: '🙂' },
  rivals: { key: 'rivals', label: 'Rivals', emoji: '⚔️' },
  enemies: { key: 'enemies', label: 'Enemies', emoji: '😤' },
};

export function labelFor({ affinity = 0, romance = 0 } = {}, { romance: romanceOn = true } = {}) {
  if (romanceOn && affinity >= 50 && romance >= 75) return LABELS.sweethearts;
  if (romanceOn && affinity >= 40 && romance >= 40) return LABELS.crush;
  if (affinity >= 65) return LABELS.bestfriends;
  if (affinity >= 30) return LABELS.friends;
  if (affinity <= -60) return LABELS.enemies;
  if (affinity <= -30) return LABELS.rivals;
  return LABELS.coworkers;
}

export function pairKey(a, b) {
  return [a, b].sort().join('|');
}

/** Deterministic 0…1 "spark" for a pair, so chemistry is stable across restarts. */
export function chemistry(key) {
  return crypto.createHash('sha256').update(key).digest().readUInt16BE(0) / 0xffff;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round1 = (v) => Math.round(v * 10) / 10;

export class RelationshipStore {
  constructor(file = FILE, { now = Date.now, rng = Math.random } = {}) {
    this.file = file;
    this.now = now;
    this.rng = rng;
    this.pairs = {};
    this.saveTimer = null;
  }

  load() {
    try {
      this.pairs = JSON.parse(fs.readFileSync(this.file, 'utf8')).pairs || {};
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn(`[relationships] could not read ${this.file}: ${err.message}`);
      this.pairs = {};
    }
    return this;
  }

  get(a, b) {
    return this.pairs[pairKey(a, b)] || { affinity: 0, romance: 0, interactions: 0, updatedAt: 0 };
  }

  nextRomance(before, affinity, kind, key, romanceOn) {
    if (!romanceOn) return 0;
    if (ALL_INTERACTIONS[kind] < 0) return clamp(before.romance - 3, 0, 100);
    const spark = chemistry(key);
    if (affinity < ROMANCE_MIN_AFFINITY || spark < ROMANCE_MIN_CHEMISTRY) return before.romance;
    return clamp(before.romance + 2 + spark * 5 + this.rng() * 2, 0, 100);
  }

  /**
   * Applies one interaction between agents a and b (agent records with id, personality, type, role).
   * `cooldown: false` is for events the server saw happen (chat, work), which are rate limited already.
   */
  interact(a, b, kind, { romance: romanceOn = true, cooldown = true } = {}) {
    const key = pairKey(a.id, b.id);
    const before = this.get(a.id, b.id);
    const now = this.now();
    const tooSoon = cooldown && now - before.updatedAt < PAIR_COOLDOWN_MS;
    if (!Object.hasOwn(ALL_INTERACTIONS, kind) || a.id === b.id || tooSoon) {
      return { applied: false, key, rel: before, label: labelFor(before, { romance: romanceOn }) };
    }
    const swing = (this.rng() * 2 - 1) * RANDOM_SWING;
    const sameTeam = a.role === 'worker' && b.role === 'worker' && a.type === b.type ? SAME_TEAM_BONUS : 0;
    const delta = ALL_INTERACTIONS[kind] + compatibility(a.personality, b.personality) * COMPAT_WEIGHT + sameTeam + swing;
    const affinity = clamp(before.affinity + delta, -100, 100);
    const rel = {
      affinity: round1(affinity),
      romance: round1(this.nextRomance(before, affinity, kind, key, romanceOn)),
      interactions: before.interactions + 1,
      updatedAt: now,
    };
    this.pairs = { ...this.pairs, [key]: rel };
    this.scheduleSave();
    const prevLabel = labelFor(before, { romance: romanceOn });
    const label = labelFor(rel, { romance: romanceOn });
    const newCrush = romanceOn && ROMANTIC.has(label.key) && !ROMANTIC.has(prevLabel.key);
    const jealousy = newCrush ? [...this.jealousy(a.id, b.id, now), ...this.jealousy(b.id, a.id, now)] : [];
    return { applied: true, key, rel, label, prevLabel, changed: label.key !== prevLabel.key, jealousy };
  }

  /**
   * `fickle` just developed a crush on `crush`. Everyone `fickle` was already crushing on or
   * dating gets jealous: they cool on `fickle` and become rivals with `crush`.
   * Returns [{ jealous, fickle, crush, changes: [{ key, a, b, rel, label, prevLabel, changed }] }].
   */
  jealousy(fickle, crush, now) {
    const exes = this.list({ romance: true })
      .filter((r) => (r.a === fickle || r.b === fickle) && ROMANTIC.has(r.label.key))
      .map((r) => (r.a === fickle ? r.b : r.a))
      .filter((id) => id !== crush);
    return exes.map((jealous) => ({
      jealous, fickle, crush,
      changes: [
        this.adjust(jealous, fickle, now, (r) => ({ affinity: r.affinity - JILTED_AFFINITY_HIT, romance: r.romance - JILTED_ROMANCE_HIT })),
        this.adjust(jealous, crush, now, (r) => ({ affinity: Math.min(r.affinity - RIVAL_AFFINITY_HIT, RIVAL_AFFINITY_CAP), romance: 0 })),
      ],
    }));
  }

  /** Sets a pair's scores directly (not an interaction), reporting any label change. */
  adjust(a, b, now, fn) {
    const key = pairKey(a, b);
    const before = this.get(a, b);
    const next = fn(before);
    const rel = {
      ...before,
      affinity: round1(clamp(next.affinity, -100, 100)),
      romance: round1(clamp(next.romance, 0, 100)),
      updatedAt: now,
    };
    this.pairs = { ...this.pairs, [key]: rel };
    this.scheduleSave();
    const [x, y] = key.split('|');
    const prevLabel = labelFor(before);
    const label = labelFor(rel);
    return { key, a: x, b: y, rel, label, prevLabel, changed: label.key !== prevLabel.key };
  }

  list(options) {
    return Object.entries(this.pairs).map(([key, rel]) => {
      const [a, b] = key.split('|');
      return { key, a, b, ...rel, label: labelFor(rel, options) };
    });
  }

  /** One agent's relationships, closest first: [{ other, affinity, romance, interactions, label }]. */
  forAgent(id, options) {
    return this.list(options)
      .filter((r) => r.a === id || r.b === id)
      .map(({ a, b, key: _key, updatedAt: _at, ...rest }) => ({ other: a === id ? b : a, ...rest }))
      .sort((x, y) => y.affinity - x.affinity);
  }

  removeAgent(id) {
    this.pairs = Object.fromEntries(Object.entries(this.pairs).filter(([key]) => !key.split('|').includes(id)));
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
    fs.writeFileSync(tmp, JSON.stringify({ pairs: this.pairs }, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
