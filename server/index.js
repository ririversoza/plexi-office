import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import { WebSocketServer } from 'ws';
import {
  AGENT_TYPES, AUTO_MEMORY, DATA_DIR, DEFAULT_CWD, WORKSPACE_REPO, GIT_POLL_MS, HOST, PORT, PUBLIC_DIR, ROOT_DIR, STATUS_TICK_MS, SUPERMEMORY,
} from './config.js';
import { AgentStore, ValidationError } from './store.js';
import { SessionManager } from './sessions.js';
import { detectClis, findExecutable, gitConflicts, resolvePath } from './clis.js';
import { buildInstall, buildLaunch } from './launch.js';
import { createGuards } from './security.js';
import { STATES } from './status.js';
import { ARCHETYPES, buildPersonaPrompt, describePersonality } from './personality.js';
import { KeyRedactor, MemoryService, agentTag } from './memory.js';
import { ROLE_LABELS, createToolsRouter, teamLabel } from './tools.js';
import { BreakScheduler } from './breaks.js';
import { loadSettings, saveSettings, DEFAULT_WRITER, WRITER_INTERVALS } from './settings.js';
import { CHAT_VIBES, INTERACTIONS, RelationshipStore } from './relationships.js';
import { sanitizeLook } from './look.js';
import { Feed, sanitizeLines } from './feed.js';
import { canonBrief, sanitizeCanon } from './canon.js';
import { TONE_TO_KIND, Writer } from './writer.js';
import { resolvePermissions, sanitizePermissions } from './permissions.js';
import { quarantinePolicyFiles } from './workspace.js';
import { GitHubService } from './github.js';
import { SanctionStore } from './sanctions.js';
import { SPRITE_SLOTS, SpriteStore } from './sprites.js';
import { ChatStore, MANAGER_ID } from './chat.js';
import { autoReportText, wakePrompt } from './reports.js';

const SECRET = crypto.randomBytes(24).toString('hex');
const BASE_URL = `http://${HOST}:${PORT}`;
const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';
const SUBMIT_DELAY_MS = { codex: 600 };
const HOOK_KINDS = new Set(['prompt', 'pretool', 'posttool', 'notification', 'stop', 'turn-complete']);
const MAX_WS_INPUT = 64 * 1024;
const MEMORY_POLL_MS = 5000;
const AUTO_MEMORY_MIN_CHARS = 80;
const AUTO_MEMORY_THROTTLE_MS = 5 * 60_000; // each save runs the memory model + embeddings
const MEMORY_SERVICE_ID = 'service:supermemory';
const MANAGER_NAME = os.userInfo().username;

const store = new AgentStore().load();
const sessions = new SessionManager();
const guards = createGuards({ port: PORT, token: SECRET });
const memory = new MemoryService();
const statusCache = new Map();
const statusKeys = new Map();
let settings = loadSettings();
const breaks = new BreakScheduler({ config: settings.breaks });
const relationships = new RelationshipStore().load();
const feed = new Feed().load();
const sanctions = new SanctionStore().load();
const sprites = new SpriteStore();
const chat = new ChatStore().load();
const reports = new ChatStore(path.join(DATA_DIR, 'reports.json'), { maxText: 1200, cooldownMs: 0 }).load();
const relOptions = () => ({ romance: settings.social.romance });

/**
 * Applies an interaction between two agents and tells the office. Break-room chats keep the
 * pair cooldown; `{ cooldown: false }` is for chat and work the server saw happen itself.
 */
function applyInteraction(a, b, kind, { cooldown = true } = {}) {
  const result = relationships.interact(a, b, kind, { ...relOptions(), cooldown });
  if (result.applied) announceRelationship({ ...result, a: a.id, b: b.id });
  // A love triangle: the one left behind cools on the fickle one and turns on the new crush.
  for (const { jealous, fickle, crush, changes } of result.jealousy || []) {
    broadcast({ t: 'feed', entry: feed.add({ type: 'gossip', kind: 'jealousy', a: jealous, b: fickle, c: crush }) });
    for (const change of changes) announceRelationship(change);
  }
  return result;
}

/** Broadcasts a pair's new scores, plus a gossip entry when its label changed. */
function announceRelationship({ key, a, b, rel, label, prevLabel, changed }) {
  if (changed) broadcast({ t: 'feed', entry: feed.add({ type: 'gossip', a, b, label, prevLabel }) });
  broadcast({ t: 'relationship', key, a, b, ...rel, label, prevLabel, changed });
}

/** Work and chat between two agents (either may be missing, e.g. after a firing). */
function workedWith(a, b, kind) {
  if (a && b && a.id !== b.id) applyInteraction(a, b, kind, { cooldown: false });
}

/** Everyone a group chat post @mentions, by name (not @all). */
function chatMentioned(message, by) {
  const kind = CHAT_VIBES[message.vibe] || 'chat';
  for (const id of message.mentions) workedWith(by, store.get(id), kind);
}

/** One agent's relationships for `plexi whoami`. */
function relationshipsOf(agent) {
  return relationships.forAgent(agent.id, relOptions()).flatMap((r) => {
    const other = store.get(r.other);
    return other ? [{ name: other.name, label: r.label.label, emoji: r.label.emoji, affinity: r.affinity }] : [];
  });
}
const lastAutoMemory = new Map();
// Reports to the Assistant Manager: when each agent's current stretch of work began, and their last report.
const turnStarts = new Map();
const lastReportAt = new Map();

let clis = await detectClis();

// ── broadcasting ────────────────────────────────────────────────────────────
const clients = new Set();

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(msg) {
  const payload = JSON.stringify(msg);
  for (const ws of clients) if (ws.readyState === ws.OPEN) ws.send(payload);
}

function statusOf(id) {
  return statusCache.get(id) || { state: STATES.OFFLINE, detail: '', since: Date.now() };
}

function agentView(agent) {
  return {
    ...agent,
    roleLabel: ROLE_LABELS[agent.role],
    team: teamLabel(agent),
    persona: describePersonality(agent.personality),
    status: statusOf(agent.id),
    running: sessions.isRunning(agent.id),
    sanction: sanctions.current(agent.id),
  };
}

function broadcastAgents() {
  broadcast({ t: 'agents', agents: store.list().map(agentView) });
}

/** Recomputes an agent's status (tracker → break schedule) and broadcasts changes. */
function refreshStatus(id) {
  const session = sessions.get(id);
  if (!session || session.kind !== 'agent') return;
  const snap = breaks.apply(id, session.tracker.snapshot());
  const key = `${snap.state}|${snap.detail}|${snap.activity || ''}`;
  const prev = statusKeys.get(id);
  if (prev?.key === key) return;
  const since = prev?.state === snap.state ? prev.since : Date.now();
  statusKeys.set(id, { key, state: snap.state, since });
  if (snap.state === 'working' && !turnStarts.has(id)) turnStarts.set(id, Date.now());
  const status = { ...snap, since };
  statusCache.set(id, status);
  broadcast({ t: 'status', id, status, running: sessions.isRunning(id) });
}

async function memoryView() {
  const pathEnv = await resolvePath();
  return {
    ...memory.status(),
    label: SUPERMEMORY.label,
    installed: Boolean(findExecutable(SUPERMEMORY.bin, pathEnv)),
    managed: sessions.isRunning(MEMORY_SERVICE_ID),
    install: SUPERMEMORY.install,
    docs: SUPERMEMORY.docs,
    serviceId: MEMORY_SERVICE_ID,
    autoMemory: AUTO_MEMORY,
  };
}

sessions.on('data', (id, data) => {
  for (const ws of clients) if (ws.subs?.has(id)) send(ws, { t: 'out', id, data });
});

/** The memory server prints its API key on first boot: capture it, and blank it out of the terminal. */
function memoryKeyFilter() {
  const redactor = new KeyRedactor((key) => {
    if (!memory.hasKey() && memory.setKey(key, 'captured')) {
      console.log('[plexi] captured the Supermemory API key from the memory server (kept in memory only)');
      pollMemory();
    }
  });
  return (data, deliver) => redactor.push(data, deliver);
}

sessions.on('exit', (id, code) => {
  refreshStatus(id);
  broadcast({ t: 'exit', id, code });
});

// ── agent lifecycle ─────────────────────────────────────────────────────────
class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

async function startAgent(agent, { cols, rows, initialPrompt } = {}) {
  if (sessions.isRunning(agent.id)) return;
  const suspended = sanctions.suspension(agent.id);
  if (suspended) {
    throw new HttpError(423, `${agent.name} is suspended by ${suspended.by} until ${new Date(suspended.until).toLocaleTimeString()}: ${suspended.reason}`);
  }
  guardWorkspacePolicies();
  clis = await detectClis({ refresh: true });
  const cli = clis[agent.type];
  if (!cli?.installed) {
    throw new HttpError(409, `${cli.label} (${cli.bin}) is not installed.`, { needsInstall: true, cli });
  }
  const persona = buildPersonaPrompt(agent, {
    managerName: MANAGER_NAME, memoryEnabled: true, defaultCwd: DEFAULT_CWD, canon: canonBrief(agent),
    sanction: sanctions.current(agent.id),
  });
  const spec = buildLaunch(agent, {
    binPath: cli.path, pathEnv: await resolvePath(), url: BASE_URL, token: guards.agentToken(agent.id), persona,
    permissions: resolvePermissions(settings.permissions),
  });
  // `--` so a prompt starting with "-" can never be parsed as a CLI flag.
  if (initialPrompt) spec.args.push('--', String(initialPrompt).slice(0, 4000));
  try {
    // Staff talk about conflicts in their reports; only real git conflicts count for them.
    sessions.spawn(agent.id, { ...spec, cwd: agent.cwd, cols, rows, textConflicts: agent.role === 'worker' });
  } catch (err) {
    throw new HttpError(500, `Could not launch ${cli.bin}: ${err.message}`);
  }
  refreshStatus(agent.id);
}

/** Types a message into an agent's terminal (starting it with the message if needed). */
async function sayTo(agent, text) {
  const message = String(text || '').trim().slice(0, 4000);
  if (!message) throw new HttpError(400, 'Nothing to say');
  if (!sessions.isRunning(agent.id)) return startAgent(agent, { initialPrompt: message });
  // Codex treats fast typing as a paste and turns an Enter inside it into a newline,
  // so it gets a real (bracketed) paste and a later Enter.
  const pasted = agent.type === 'codex' ? `${PASTE_START}${message}${PASTE_END}` : message;
  sessions.write(agent.id, pasted);
  // Submit separately so TUIs don't treat the newline as part of a paste.
  setTimeout(() => sessions.write(agent.id, '\r'), SUBMIT_DELAY_MS[agent.type] ?? 150);
}

async function autoRemember(agent, payload) {
  if (!AUTO_MEMORY || !memory.connected) return;
  const text = String(payload.last_assistant_message ?? payload['last-assistant-message'] ?? '').trim();
  const last = lastAutoMemory.get(agent.id) || 0;
  if (text.length < AUTO_MEMORY_MIN_CHARS || Date.now() - last < AUTO_MEMORY_THROTTLE_MS) return;
  lastAutoMemory.set(agent.id, Date.now());
  const when = new Date().toISOString().slice(0, 16).replace('T', ' ');
  try {
    await memory.add(agentTag(agent.id), `${agent.name} finished a turn in ${agent.cwd} (${when}): ${text.slice(0, 1500)}`, {
      agent: agent.name, team: teamLabel(agent), cwd: agent.cwd, source: 'auto-turn',
    });
  } catch (err) {
    console.warn(`[memory] auto-save for ${agent.name} failed: ${err.message}`);
  }
}

function assistantAgent() {
  return store.list().find((a) => a.role === 'assistant') || null;
}

function announceReport(message, agent) {
  lastReportAt.set(agent.id, message.at);
  broadcast({ t: 'feed', entry: feed.add({ type: 'report', a: agent.id, text: message.text, auto: Boolean(message.auto) }) });
  scheduleAssistantWake();
}

// ── waking the Assistant Manager for every report ─────────────────────────
// Reports that land together go in one wake. While she's mid-turn her hooks deliver them;
// while a question or permission prompt is on her screen we wait, since typing could answer it.
const WAKE_DEBOUNCE_MS = 3000;
const WAKE_COOLDOWN_MS = 20_000;
const WAKE_RETRY_MS = 15_000;
let wakeTimer = null;
let lastWakeAt = 0;

function scheduleAssistantWake(delay = WAKE_DEBOUNCE_MS) {
  clearTimeout(wakeTimer);
  wakeTimer = setTimeout(() => {
    wakeTimer = null;
    wakeAssistant().catch((err) => console.warn(`[reports] could not wake the Assistant Manager: ${err.message}`));
  }, delay);
  wakeTimer.unref?.();
}

async function wakeAssistant() {
  const assistant = assistantAgent();
  if (!assistant || !reports.peekNudges(assistant.id).length) return;
  const wait = WAKE_COOLDOWN_MS - (Date.now() - lastWakeAt);
  if (wait > 0) return scheduleAssistantWake(wait);
  if (sessions.isRunning(assistant.id) && sessions.get(assistant.id).tracker.snapshot().state !== 'break') return;
  const { messages } = reports.nudgesFor(assistant.id);
  if (!messages.length) return;
  lastWakeAt = Date.now();
  await sayTo(assistant, wakePrompt(messages));
}

setInterval(() => {
  if (!wakeTimer) wakeAssistant().catch(() => {});
}, WAKE_RETRY_MS).unref();

/**
 * The safety net for "report to Juniper when you finish": a coding agent that just ended a
 * real stretch of work (not a quick reply, not a question) without filing a report gets one
 * filed for them from their final message.
 */
function autoReport(agent, payload) {
  const startedAt = turnStarts.get(agent.id);
  turnStarts.delete(agent.id);
  const assistant = assistantAgent();
  const text = assistant && autoReportText({
    role: agent.role, startedAt, now: Date.now(), lastReportAt: lastReportAt.get(agent.id), state: statusOf(agent.id).state,
    lastMessage: payload.last_assistant_message ?? payload['last-assistant-message'],
  });
  if (!text) return;
  try {
    const message = reports.post({ from: agent.id, name: agent.name, text, to: [assistant.id], meta: { auto: true } });
    announceReport(message, agent);
  } catch (err) {
    console.warn(`[reports] could not file ${agent.name}'s report: ${err.message}`);
  }
}

async function startInstall(id, installCommand) {
  if (sessions.isRunning(id)) return id;
  sessions.forget(id);
  const spec = buildInstall(installCommand, { pathEnv: await resolvePath() });
  sessions.spawn(id, { ...spec, cwd: os.homedir(), kind: 'install' });
  broadcast({ t: 'install-started', id });
  return id;
}

sessions.on('exit', async (id, code) => {
  if (!id.startsWith('install:')) return;
  const target = id.slice('install:'.length);
  clis = await detectClis({ refresh: true });
  const mem = await memoryView();
  const installed = target === 'supermemory' ? mem.installed : Boolean(clis[target]?.installed);
  broadcast({ t: 'clis', clis });
  broadcast({ t: 'memory', memory: mem });
  broadcast({ t: 'install-done', target, id, code, installed });
});

/**
 * Points Supermemory at an OpenAI-compatible endpoint (LM Studio, Ollama, …) via the
 * OPENAI_BASE_URL / OPENAI_MODEL variables it reads. Local servers ignore the key, so a
 * placeholder is used unless the manager exported a real OPENAI_API_KEY.
 */
function memoryLlmEnv() {
  const { baseUrl, model } = settings.memoryLlm || {};
  if (!baseUrl) return {};
  return {
    OPENAI_BASE_URL: baseUrl,
    ...(model && { OPENAI_MODEL: model }),
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || 'local-model',
  };
}

function validBaseUrl(value) {
  const text = String(value || '').trim().replace(/\/+$/, '');
  if (!text) return '';
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new HttpError(400, 'Base URL must look like http://localhost:1234/v1');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new HttpError(400, 'Base URL must be http(s).');
  return text;
}

async function startMemoryService({ cols, rows } = {}) {
  if (sessions.isRunning(MEMORY_SERVICE_ID)) return;
  const pathEnv = await resolvePath({ refresh: true });
  const bin = findExecutable(SUPERMEMORY.bin, pathEnv);
  if (!bin) throw new HttpError(409, `${SUPERMEMORY.label} is not installed.`, { needsInstall: true });
  fs.mkdirSync(SUPERMEMORY.dataDir, { recursive: true });
  sessions.forget(MEMORY_SERVICE_ID);
  sessions.spawn(MEMORY_SERVICE_ID, {
    file: bin, args: [], cwd: SUPERMEMORY.dataDir, env: { ...process.env, ...memoryLlmEnv(), PATH: pathEnv, TERM: 'xterm-256color' },
    cols, rows, kind: 'service', filter: memoryKeyFilter(),
  });
}

let lastMemoryJson = '';
async function pollMemory() {
  await memory.probe();
  const view = await memoryView();
  const json = JSON.stringify(view);
  if (json !== lastMemoryJson) {
    lastMemoryJson = json;
    broadcast({ t: 'memory', memory: view });
  }
}

// ── http ────────────────────────────────────────────────────────────────────
const app = express();
app.disable('x-powered-by');
app.use(guards.hostGuard);
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    `connect-src 'self' ws://127.0.0.1:${PORT} ws://localhost:${PORT}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "object-src 'none'",
    "frame-ancestors 'self'",
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});
app.use(express.json({ limit: '256kb' }));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function findAgent(id) {
  const agent = store.get(id);
  if (!agent) throw new HttpError(404, 'No such agent');
  return agent;
}

// Calls from agent CLIs (no browser origin) authenticate with per-agent tokens instead.
app.post('/api/hook/:id/:kind', guards.hookGuard, (req, res) => {
  const { id, kind } = req.params;
  const session = sessions.get(id);
  const agent = store.get(id);
  if (!HOOK_KINDS.has(kind) || !session || session.kind !== 'agent' || !agent) return res.status(204).end();
  const payload = req.body && typeof req.body === 'object' ? req.body : {};
  session.tracker.hook(kind, payload);
  refreshStatus(id);
  if (kind === 'stop' || kind === 'turn-complete') {
    autoRemember(agent, payload);
    autoReport(agent, payload);
    if (agent.role === 'assistant') scheduleAssistantWake(1500); // anything that came in while she worked
    broadcast({ t: 'turn', id, role: agent.role });
  }
  res.status(204).end();
});

app.use('/api/tools', createToolsRouter({
  store,
  sessions,
  statusOf,
  memory,
  guards,
  getClis: async () => (clis = await detectClis({ refresh: true })),
  onHire: (hired, by) => {
    broadcastAgents();
    broadcast({ t: 'hired', id: hired.id, by: by.name });
  },
  github: new GitHubService({ workspace: DEFAULT_CWD, repoUrl: WORKSPACE_REPO, getPath: resolvePath }),
  sanctions,
  onSanction: async (record, agent, by) => {
    if (record.level === 'suspension') {
      sessions.kill(agent.id);
    } else if (sessions.isRunning(agent.id) && statusOf(agent.id).state !== 'question') {
      await sayTo(agent, `[Note from ${by.name}, HR] You've received a warning: ${record.reason} Please don't repeat it. A second incident can mean a suspension.`)
        .catch((err) => console.warn(`[hr] could not tell ${agent.name}: ${err.message}`));
    }
    announceSanction(record, agent);
    workedWith(by, agent, 'sanction');
  },
  onLift: (agent, by) => announceLift(agent, by),
  onDecor: () => broadcastAgents(),
  sprites,
  chat,
  onChat: (message, by) => {
    broadcast({ t: 'chat', message });
    chatMentioned(message, by);
  },
  relationshipsOf,
  reports,
  onReport: (message, agent) => {
    announceReport(message, agent);
    workedWith(agent, store.list().find((a) => a.role === 'assistant'), 'teamwork');
  },
  onMerge: (merged, by) => {
    broadcast({ t: 'pr-merged', by: by.name, number: merged.number, title: merged.title });
    const author = store.list().find((a) => a.name === merged.openedBy);
    workedWith(by, author, 'teamwork');
  },
  onAssign: async (agent, task, by) => {
    await sayTo(agent, `[Task from ${by.name}, Assistant Manager, on behalf of ${MANAGER_NAME}] ${task}`);
    workedWith(by, agent, 'teamwork');
  },
}));

app.use('/api', guards.originGuard);

app.get('/api/state', wrap(async (req, res) => {
  if (req.query.refresh) clis = await detectClis({ refresh: true });
  res.json({
    agents: store.list().map(agentView),
    clis,
    types: AGENT_TYPES,
    personalities: Object.entries(ARCHETYPES).filter(([, a]) => !a.staffOnly).map(([key, a]) => ({ key, ...a })),
    memory: await memoryView(),
    settings,
    relationships: relationships.list(relOptions()),
    defaultCwd: DEFAULT_CWD,
    manager: { name: MANAGER_NAME },
  });
}));

app.post('/api/agents', (req, res) => {
  const agent = store.create(req.body || {});
  broadcastAgents();
  broadcast({ t: 'hired', id: agent.id, by: MANAGER_NAME });
  res.status(201).json(agentView(agent));
});

app.patch('/api/agents/:id', (req, res) => {
  findAgent(req.params.id);
  const updated = store.update(req.params.id, req.body || {});
  broadcastAgents();
  res.json(agentView(updated));
});

// ── HR sanctions ────────────────────────────────────────────────────────────
function announceSanction(record, agent) {
  const entry = feed.add({ type: 'hr', a: agent.id, level: record.level, reason: record.reason, by: record.by, until: record.until });
  broadcast({ t: 'feed', entry });
  broadcast({ t: 'sanctioned', id: agent.id, level: record.level, reason: record.reason, by: record.by, until: record.until });
  broadcastAgents();
}

function announceLift(agent, by) {
  broadcast({ t: 'feed', entry: feed.add({ type: 'hr', a: agent.id, level: 'lifted', by }) });
  broadcastAgents();
}

// ── group chat (the manager's side) ───────────────────────────────────────
app.get('/api/chat', (req, res) => res.json({ messages: chat.recent(Number(req.query.limit) || 100), managerId: MANAGER_ID }));

app.post('/api/chat', (req, res) => {
  const message = chat.post({ from: MANAGER_ID, name: MANAGER_NAME, text: req.body?.text, agents: store.list() });
  broadcast({ t: 'chat', message });
  res.status(201).json(message);
});

/** An agent's own decor drawing. Shown only as an image; the headers stop it running anything if opened directly. */
app.get('/api/sprites/:id/:slot.svg', (req, res) => {
  const agent = findAgent(req.params.id);
  const svg = SPRITE_SLOTS.includes(req.params.slot) ? sprites.read(agent.id, req.params.slot) : null;
  if (!svg) return res.status(404).end();
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.send(svg);
});

app.get('/api/agents/:id/sanctions', (req, res) => {
  const agent = findAgent(req.params.id);
  res.json({ current: sanctions.current(agent.id), history: sanctions.history(agent.id) });
});

/** The manager can lift anything HR issued. */
app.post('/api/agents/:id/sanctions/lift', (req, res) => {
  const agent = findAgent(req.params.id);
  const lifted = sanctions.lift({ agentId: agent.id, by: MANAGER_NAME });
  if (lifted.length) announceLift(agent, MANAGER_NAME);
  res.json({ lifted: lifted.length, agent: agentView(agent) });
});

// Suspensions and warnings run out on their own; keep everyone's badge current.
let sanctionKey = '';
setInterval(() => {
  const key = store.list().map((a) => sanctions.current(a.id)?.id || '').join('|');
  if (key !== sanctionKey) {
    if (sanctionKey) broadcastAgents();
    sanctionKey = key;
  }
}, 15_000).unref();

app.delete('/api/agents/:id', (req, res) => {
  findAgent(req.params.id);
  store.remove(req.params.id);
  sessions.forget(req.params.id);
  statusCache.delete(req.params.id);
  statusKeys.delete(req.params.id);
  breaks.forget(req.params.id);
  relationships.removeAgent(req.params.id);
  feed.removeAgent(req.params.id);
  sanctions.removeAgent(req.params.id);
  sprites.remove(req.params.id);
  chat.removeAgent(req.params.id);
  reports.removeAgent(req.params.id);
  broadcastAgents();
  res.status(204).end();
});

app.post('/api/agents/:id/start', wrap(async (req, res) => {
  const agent = findAgent(req.params.id);
  await startAgent(agent, req.body || {});
  res.json(agentView(agent));
}));

app.post('/api/agents/:id/stop', (req, res) => {
  const agent = findAgent(req.params.id);
  sessions.kill(agent.id);
  res.json(agentView(agent));
});

app.post('/api/agents/:id/say', wrap(async (req, res) => {
  const agent = findAgent(req.params.id);
  await sayTo(agent, req.body?.text);
  res.json(agentView(agent));
}));

app.get('/api/agents/:id/memories', wrap(async (req, res) => {
  const agent = findAgent(req.params.id);
  if (!memory.connected) return res.json({ connected: false, results: [] });
  const q = String(req.query.q || `${agent.name}: recent work, decisions and preferences`);
  res.json({ connected: true, results: await memory.search([agentTag(agent.id)], q, { limit: 8, threshold: 0.2 }) });
}));

app.post('/api/start-all', wrap(async (req, res) => {
  const started = [];
  const skipped = [];
  for (const agent of store.list()) {
    if (sessions.isRunning(agent.id)) continue;
    try {
      await startAgent(agent);
      started.push(agent.id);
    } catch (err) {
      skipped.push({ id: agent.id, reason: err.message });
    }
  }
  res.json({ started, skipped });
}));

app.post('/api/clis/:type/install', wrap(async (req, res) => {
  const { type } = req.params;
  if (!Object.hasOwn(AGENT_TYPES, type)) throw new HttpError(404, 'Unknown CLI');
  const id = await startInstall(`install:${type}`, AGENT_TYPES[type].install);
  res.json({ id, command: AGENT_TYPES[type].install });
}));

app.get('/api/settings', (req, res) => res.json(settings));

app.patch('/api/settings', (req, res) => {
  const social = req.body?.social;
  const lookInput = req.body?.manager?.look;
  const next = {
    ...settings,
    ...(lookInput !== undefined && { manager: { look: lookInput === null ? null : sanitizeLook(lookInput) } }),
    ...(req.body?.permissions !== undefined && { permissions: sanitizePermissions(req.body.permissions, settings.permissions) }),
    breaks: breaks.configure(req.body?.breaks || {}),
    social: { ...settings.social, ...(typeof social?.romance === 'boolean' && { romance: social.romance }) },
  };
  saveSettings(next);
  const romanceChanged = next.social.romance !== settings.social.romance;
  settings = next;
  broadcast({ t: 'settings', settings });
  if (romanceChanged) broadcast({ t: 'relationships', pairs: relationships.list(relOptions()) });
  res.json(settings);
});

app.patch('/api/memory/llm', (req, res) => {
  const baseUrl = validBaseUrl(req.body?.baseUrl);
  const model = String(req.body?.model || '').trim().slice(0, 200);
  settings = { ...settings, memoryLlm: { baseUrl, model } };
  saveSettings(settings);
  broadcast({ t: 'settings', settings });
  res.json(settings.memoryLlm);
});

/** Lists models an OpenAI-compatible server offers, so the manager can pick one. */
app.get('/api/memory/llm/models', wrap(async (req, res) => {
  const baseUrl = validBaseUrl(req.query.baseUrl);
  if (!baseUrl) return res.json({ models: [] });
  try {
    const r = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(3000) });
    const data = await r.json();
    res.json({ models: (data.data || []).map((m) => m.id).filter((id) => typeof id === 'string').slice(0, 100) });
  } catch (err) {
    throw new HttpError(502, `Couldn't reach ${baseUrl} (${err.message}). Is the server running?`);
  }
}));

app.get('/api/feed', (req, res) => res.json({ entries: feed.list() }));

app.patch('/api/settings/writer', (req, res) => {
  const mode = req.body?.mode === 'llm' ? 'llm' : 'script';
  const every = Number(req.body?.everySeconds);
  const writerSettings = {
    mode,
    baseUrl: validBaseUrl(req.body?.baseUrl),
    model: String(req.body?.model || '').trim().slice(0, 200),
    everySeconds: WRITER_INTERVALS.includes(every) ? every : DEFAULT_WRITER.everySeconds,
  };
  if (mode === 'llm' && (!writerSettings.baseUrl || !writerSettings.model)) {
    throw new HttpError(400, 'Pick a model server and a model for the writer.');
  }
  settings = { ...settings, writer: writerSettings };
  saveSettings(settings);
  broadcast({ t: 'settings', settings });
  res.json(settings.writer);
});

function writerLlm() {
  const w = settings.writer || {};
  return w.mode === 'llm' && w.baseUrl && w.model ? { baseUrl: w.baseUrl, model: w.model } : null;
}

function doingNow(agent) {
  const status = statusOf(agent.id);
  const project = path.basename(agent.cwd);
  const activity = status.activity || status.detail || status.state;
  return `${status.state} in the ${project} project (${activity})`;
}

function sharedHistory(a, b) {
  return feed.list(60)
    .filter((e) => e.type === 'chat' && [e.a, e.b].includes(a.id) && [e.a, e.b].includes(b.id))
    .slice(0, 2)
    .flatMap((e) => (e.lines || []).slice(0, 3).map((l) => `${l.who === 0 ? store.get(e.a)?.name : store.get(e.b)?.name}: ${l.text}`))
    .join('\n');
}

const writer = new Writer();
// Local models run hot; only let one chat in every `everySeconds` be model-written.
let lastWrittenAt = 0;
// Receipts for model-written chats: in model mode only these reach the feed and relationships.
const WRITTEN_TTL_MS = 10 * 60_000;
const writtenChats = new Map(); // ticket -> { a, b, room, kind, lines, at }

function rememberWritten(chat) {
  const now = Date.now();
  for (const [t, c] of writtenChats) if (now - c.at > WRITTEN_TTL_MS) writtenChats.delete(t);
  const ticket = crypto.randomBytes(9).toString('hex');
  writtenChats.set(ticket, { ...chat, at: now });
  return ticket;
}

/** A model-written conversation for two agents, or { source: 'script' } so the browser uses its own lines. */
app.post('/api/social/dialogue', wrap(async (req, res) => {
  const a = store.get(String(req.body?.a));
  const b = store.get(String(req.body?.b));
  if (!a || !b) throw new HttpError(400, 'Unknown agents');
  const llm = writerLlm();
  if (!llm) return res.json({ source: 'script' });
  const gapMs = (settings.writer?.everySeconds || DEFAULT_WRITER.everySeconds) * 1000;
  if (Date.now() - lastWrittenAt < gapMs) return res.json({ source: 'script', reason: 'cooldown' });
  lastWrittenAt = Date.now();
  const rel = relationships.get(a.id, b.id);
  const label = relationships.list(relOptions()).find((r) => r.key === [a.id, b.id].sort().join('|'))?.label;
  try {
    const { lines, tone } = await writer.writeDialogue(llm, {
      room: req.body?.room === 'conflict' ? 'conflict' : 'break',
      names: [a.name, b.name],
      briefA: canonBrief(a),
      briefB: canonBrief(b),
      doingA: doingNow(a),
      doingB: doingNow(b),
      relationship: `${label ? label.label : 'Coworkers'} (affinity ${Math.round(rel.affinity)}/100${rel.romance > 0 ? `, romance ${Math.round(rel.romance)}/100` : ''})`,
      history: sharedHistory(a, b),
      managerName: MANAGER_NAME,
    });
    const room = req.body?.room === 'conflict' ? 'conflict' : 'break';
    const ticket = rememberWritten({ a: a.id, b: b.id, room, kind: TONE_TO_KIND[tone], lines });
    res.json({ source: 'llm', lines, tone, kind: TONE_TO_KIND[tone], ticket });
  } catch (err) {
    res.json({ source: 'script', reason: err.message });
  }
}));

/** Draft a canon with the local model (the manager reviews it before saving). */
app.post('/api/agents/:id/canon/generate', wrap(async (req, res) => {
  const agent = findAgent(req.params.id);
  const llm = writerLlm() || (settings.memoryLlm?.baseUrl && settings.memoryLlm?.model ? settings.memoryLlm : null);
  if (!llm) throw new HttpError(409, 'Set up a local model under Settings → Conversations first.');
  try {
    const persona = describePersonality(agent.personality);
    const draft = await writer.writeCanon(llm, {
      name: agent.name,
      roleLabel: ROLE_LABELS[agent.role],
      team: teamLabel(agent),
      personality: `${persona.title} — ${persona.traits.join(', ')}. ${persona.workStyle}`,
      pronouns: agent.canon?.pronouns || 'they/them',
    });
    res.json({ canon: sanitizeCanon({ ...draft, pronouns: agent.canon?.pronouns || 'they/them' }) });
  } catch (err) {
    throw new HttpError(502, `The model couldn't write a canon: ${err.message}`);
  }
}));

// Newest modification time of the page's files, so open tabs can notice an update and reload.
function pageVersion() {
  let newest = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else newest = Math.max(newest, fs.statSync(full).mtimeMs);
    }
  };
  walk(PUBLIC_DIR);
  return String(Math.floor(newest));
}

app.get('/api/version', (req, res) => res.json({ version: pageVersion() }));

app.get('/api/relationships', (req, res) => res.json({ pairs: relationships.list(relOptions()) }));

// Browsers report what happened on a break; the server decides how it changes the relationship.
app.post('/api/relationships/interact', (req, res) => {
  const { a, b, kind } = req.body || {};
  const agentA = store.get(String(a));
  const agentB = store.get(String(b));
  if (!agentA || !agentB || !Object.hasOwn(INTERACTIONS, kind)) throw new HttpError(400, 'Unknown agents or interaction');
  let lines = sanitizeLines(req.body?.lines);
  let room = ['break', 'conflict'].includes(req.body?.room) ? req.body.room : 'break';
  if (settings.writer?.mode === 'llm') {
    // Only chats the model actually wrote count; an out-of-date page's scripted lines are ignored.
    const written = writtenChats.get(String(req.body?.ticket || ''));
    if (!written || written.a !== agentA.id || written.b !== agentB.id) return res.json({ applied: false, ignored: 'not model-written' });
    writtenChats.delete(String(req.body.ticket));
    ({ lines, room } = written);
  }
  if (lines.length) {
    broadcast({ t: 'feed', entry: feed.add({ type: 'chat', a: agentA.id, b: agentB.id, room, kind, lines }) });
  }
  const result = applyInteraction(agentA, agentB, kind);
  res.json({ applied: result.applied, label: result.label });
});

app.get('/api/memory', wrap(async (req, res) => res.json(await memoryView())));

app.post('/api/memory/install', wrap(async (req, res) => {
  const id = await startInstall('install:supermemory', SUPERMEMORY.install);
  res.json({ id, command: SUPERMEMORY.install });
}));

app.post('/api/memory/start', wrap(async (req, res) => {
  await startMemoryService(req.body || {});
  res.json(await memoryView());
}));

app.post('/api/memory/stop', wrap(async (req, res) => {
  sessions.kill(MEMORY_SERVICE_ID);
  res.json(await memoryView());
}));

app.post('/api/memory/key', wrap(async (req, res) => {
  if (!memory.setKey(req.body?.key)) throw new HttpError(400, 'That does not look like a Supermemory key (sm_…).');
  await pollMemory();
  res.json(await memoryView());
}));

app.use('/vendor/xterm', express.static(path.join(ROOT_DIR, 'node_modules/@xterm/xterm')));
app.use('/vendor/xterm-fit', express.static(path.join(ROOT_DIR, 'node_modules/@xterm/addon-fit')));
app.use(express.static(PUBLIC_DIR));

app.use((err, req, res, _next) => {
  if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
  console.error('[server]', err);
  res.status(500).json({ error: 'Something went wrong in the office.' });
});

// ── websocket ───────────────────────────────────────────────────────────────
const server = http.createServer(app);
const wss = new WebSocketServer({
  server,
  path: '/ws',
  maxPayload: 1024 * 1024,
  verifyClient: ({ req }) => guards.verifyWebSocket(req),
});

function handleClientMessage(ws, msg) {
  const id = typeof msg.id === 'string' && msg.id.length < 64 ? msg.id : null;
  if (!id) return;
  switch (msg.t) {
    case 'attach':
      ws.subs.add(id);
      send(ws, { t: 'replay', id, data: sessions.replay(id), running: sessions.isRunning(id) });
      break;
    case 'detach':
      ws.subs.delete(id);
      break;
    case 'input':
      if (typeof msg.data === 'string' && msg.data.length <= MAX_WS_INPUT) {
        sessions.write(id, msg.data);
        refreshStatus(id);
      }
      break;
    case 'resize':
      sessions.resize(id, msg.cols, msg.rows);
      break;
    default:
      break;
  }
}

wss.on('connection', async (ws) => {
  ws.subs = new Set();
  clients.add(ws);
  send(ws, { t: 'agents', agents: store.list().map(agentView) });
  send(ws, { t: 'clis', clis });
  send(ws, { t: 'memory', memory: await memoryView() });
  ws.on('message', (raw) => {
    try {
      handleClientMessage(ws, JSON.parse(String(raw)));
    } catch {
      // ignore malformed frames
    }
  });
  ws.on('close', () => clients.delete(ws));
});

// ── background loops ────────────────────────────────────────────────────────
setInterval(() => {
  for (const agent of store.list()) {
    const session = sessions.get(agent.id);
    if (session && !session.exited) session.tracker.observeScreen(sessions.visibleText(agent.id));
    refreshStatus(agent.id);
  }
}, STATUS_TICK_MS).unref();

// Keep another CLI's sandbox config out of the workspace (see workspace.js).
function guardWorkspacePolicies() {
  let moved = [];
  try {
    moved = quarantinePolicyFiles(DEFAULT_CWD);
  } catch (err) {
    console.warn(`[workspace] could not move a sandbox policy file aside: ${err.message}`);
  }
  for (const { aside } of moved) {
    console.warn(`[workspace] moved an agent-written sandbox policy aside: ${aside}`);
    broadcast({ t: 'policy-rejected', file: path.relative(DEFAULT_CWD, aside) });
  }
}
guardWorkspacePolicies();
setInterval(guardWorkspacePolicies, 1000).unref();

let polling = false;
setInterval(async () => {
  if (polling) return;
  polling = true;
  try {
    for (const session of sessions.running('agent')) {
      const agent = store.get(session.id);
      if (agent) session.tracker.setGitConflicts(await gitConflicts(agent.cwd));
    }
  } finally {
    polling = false;
  }
}, GIT_POLL_MS).unref();

setInterval(() => pollMemory().catch(() => {}), MEMORY_POLL_MS).unref();
pollMemory().catch(() => {});

function shutdown() {
  console.log('\n[plexi] closing the office — sending everyone home');
  sessions.killAll();
  relationships.flush();
  feed.flush();
  server.close();
  setTimeout(() => process.exit(0), 300).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, HOST, () => {
  const installed = Object.entries(clis).map(([t, c]) => `${t}:${c.installed ? '✓' : '✗'}`).join('  ');
  console.log(`[plexi] office open at ${BASE_URL}  (${installed})`);
});
