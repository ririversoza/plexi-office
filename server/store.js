import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { AGENT_TYPES, DATA_DIR, DEFAULT_CWD, DEFAULT_ROSTER, MAX_AGENTS_PER_TYPE, STAFF } from './config.js';
import { ARCHETYPES, pickArchetype } from './personality.js';
import { sanitizeCanon, templateCanon } from './canon.js';
import { isInsideWorkspace } from './workspace.js';
import { sanitizeDecor } from './decor.js';

const STORE_FILE = path.join(DATA_DIR, 'agents.json');
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} _.'-]{0,23}$/u;

export class ValidationError extends Error {}

function newId() {
  return `a_${crypto.randomBytes(4).toString('hex')}`;
}

function newLook() {
  return { seed: crypto.randomInt(1, 2 ** 31) };
}

export function validateName(name) {
  const trimmed = String(name ?? '').trim();
  if (!NAME_RE.test(trimmed)) {
    throw new ValidationError('Name must be 1–24 letters, numbers, spaces, dots, dashes or underscores.');
  }
  return trimmed;
}

export function validateType(type) {
  if (!Object.hasOwn(AGENT_TYPES, type)) throw new ValidationError(`Unknown agent type "${type}".`);
  return type;
}

export function validatePersonality(key, seed) {
  if (key === undefined || key === null || key === '') return pickArchetype(seed);
  if (!Object.hasOwn(ARCHETYPES, key) || ARCHETYPES[key].staffOnly) {
    throw new ValidationError(`Unknown personality "${key}".`);
  }
  return key;
}

export function validateCwd(cwd) {
  let dir = String(cwd ?? '').trim() || DEFAULT_CWD;
  if (dir === '~' || dir.startsWith('~/')) dir = path.join(os.homedir(), dir.slice(1));
  if (!path.isAbsolute(dir)) throw new ValidationError('Working directory must be an absolute path.');
  const resolved = path.resolve(dir);
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new ValidationError(`Directory not found: ${resolved}`);
  }
  if (!stat.isDirectory()) throw new ValidationError(`Not a directory: ${resolved}`);
  if (!isInsideWorkspace(resolved, DEFAULT_CWD)) {
    throw new ValidationError(`Agents can only work inside the office workspace (${DEFAULT_CWD}).`);
  }
  return resolved;
}

function makeAgent({ name, type, role = 'worker', personality, cwd = DEFAULT_CWD }) {
  const look = newLook();
  return {
    id: newId(),
    role,
    name,
    type,
    cwd,
    personality: personality || pickArchetype(look.seed),
    look,
    createdAt: new Date().toISOString(),
  };
}

/** Fills fields added after an agent was first saved. */
function migrate(agent) {
  const withDefaults = {
    ...agent,
    role: agent.role || 'worker',
    personality: ARCHETYPES[agent.personality] ? agent.personality : pickArchetype(agent.look?.seed ?? 1),
    look: agent.look || newLook(),
    // Anyone pointed outside the workspace (older saves) moves back into it.
    cwd: agent.cwd && isInsideWorkspace(agent.cwd, DEFAULT_CWD) ? agent.cwd : DEFAULT_CWD,
  };
  return { ...withDefaults, canon: { ...templateCanon(withDefaults), ...(agent.canon || {}) } };
}

export class AgentStore {
  constructor(file = STORE_FILE) {
    this.file = file;
    this.agents = [];
  }

  load() {
    fs.mkdirSync(DEFAULT_CWD, { recursive: true });
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.agents = Array.isArray(parsed.agents) ? parsed.agents.filter((a) => AGENT_TYPES[a?.type]) : [];
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn(`[store] could not read ${this.file}: ${err.message}; starting fresh`);
      this.agents = DEFAULT_ROSTER.map((seed) => makeAgent({ ...seed, role: 'worker' }));
    }
    this.agents = this.withStaff(this.agents.map(migrate));
    this.save();
    return this;
  }

  /** The Assistant Manager and HR always work here. */
  withStaff(agents) {
    const missing = STAFF.filter((staff) => !agents.some((a) => a.role === staff.role));
    return [...missing.map((staff) => makeAgent(staff)), ...agents];
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ agents: this.agents }, null, 2));
    fs.renameSync(tmp, this.file);
  }

  list() {
    return this.agents;
  }

  get(id) {
    return this.agents.find((a) => a.id === id) || null;
  }

  create({ name, type, cwd, personality }) {
    const look = newLook();
    const agent = {
      id: newId(),
      role: 'worker',
      name: validateName(name),
      type: validateType(type),
      cwd: validateCwd(cwd),
      personality: validatePersonality(personality, look.seed),
      look,
      createdAt: new Date().toISOString(),
    };
    if (this.agents.some((a) => a.name.toLowerCase() === agent.name.toLowerCase())) {
      throw new ValidationError(`Someone named ${agent.name} already works here.`);
    }
    const teamSize = this.agents.filter((a) => a.role === 'worker' && a.type === agent.type).length;
    if (teamSize >= MAX_AGENTS_PER_TYPE) {
      throw new ValidationError(`${AGENT_TYPES[agent.type].team} is full (${MAX_AGENTS_PER_TYPE} desks).`);
    }
    this.agents = [...this.agents, agent];
    this.save();
    return agent;
  }

  update(id, changes) {
    const current = this.get(id);
    if (!current) return null;
    const next = {
      ...current,
      ...(changes.name !== undefined && { name: validateName(changes.name) }),
      ...(changes.cwd !== undefined && { cwd: validateCwd(changes.cwd) }),
      ...(changes.personality !== undefined && current.role === 'worker' && {
        personality: validatePersonality(changes.personality, current.look.seed),
      }),
      ...(changes.rerollLook && { look: newLook() }),
      ...(changes.canon !== undefined && { canon: { ...current.canon, ...sanitizeCanon(changes.canon) } }),
      ...(changes.decor !== undefined && { decor: sanitizeDecor(changes.decor, current.decor, { sprites: changes.sprites }) }),
    };
    this.agents = this.agents.map((a) => (a.id === id ? next : a));
    this.save();
    return next;
  }

  remove(id) {
    if (this.get(id)?.role !== 'worker') throw new ValidationError('Office staff cannot be let go.');
    const before = this.agents.length;
    this.agents = this.agents.filter((a) => a.id !== id);
    if (this.agents.length !== before) this.save();
    return this.agents.length !== before;
  }
}
