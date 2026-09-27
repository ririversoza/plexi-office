// Plexi Office — boots the office, wires input, the socket, and the render loop.
import { Renderer } from './renderer.js';
import { AgentEntity, Manager, SeatBook } from './entities.js';
import { Social } from './social.js';
import { Socket, api } from './net.js';
import { TerminalPool } from './terminal.js';
import { Drawer } from './drawer.js';
import { HireDialog, Hud, Roster, SettingsDialog, chime, createToaster } from './ui.js';
import { Customizer } from './customizer.js';
import { ELEVATOR, ROOMS, styleFor } from './world.js';

const DRAG_THRESHOLD_PX = 6;
const PAN_DECAY = 3;
const TALK_RANGE = 1.8;
const HUD_EVERY_MS = 1000;
const ZOOM_STEP = 0.0015;
const MOVE_KEYS = {
  up: ['w', 'arrowup'], down: ['s', 'arrowdown'], left: ['a', 'arrowleft'], right: ['d', 'arrowright'],
};
const REPORT_PROMPT = 'Please give me a progress report on every agent in the office. Run `plexi status --tails`, '
  + 'lead with anything that needs me (questions, merge conflicts), then one line per agent: status, what they are doing, blockers.';

const canvas = document.getElementById('office');
const toast = createToaster(document.getElementById('toasts'));

const app = {
  agents: new Map(),
  entities: new Map(),
  clis: {},
  memory: {},
  settings: {},
  personalities: [],
  defaultCwd: '',
  managerName: 'You',
  pendingHires: new Set(),
  relationships: new Map(),
  reportPending: false,
  toast,
};

const book = new SeatBook();
const social = new Social(book);
const renderer = new Renderer(canvas);
const socket = new Socket();
const pool = new TerminalPool(socket, document.getElementById('term-host'));
let manager;
let drawer;
let hud;
let roster;
let hire;
let settingsDialog;
let customizer;
let hover = null;

// ── agents ──────────────────────────────────────────────────────────────────
function syncAgents(list) {
  app.agents = new Map(list.map((a) => [a.id, a]));
  for (const [id, entity] of app.entities) {
    if (app.agents.has(id)) continue;
    book.release(entity.spot, id);
    app.entities.delete(id);
  }
  for (const agent of list) {
    const seat = book.deskFor(agent, list);
    const bed = book.bedFor(agent, list);
    let entity = app.entities.get(agent.id);
    if (!entity) {
      const spawnAtDoor = app.pendingHires.delete(agent.id);
      entity = new AgentEntity(agent, { seat, bed, spawnAtDoor });
      app.entities.set(agent.id, entity);
    } else {
      entity.sync(agent);
      if (entity.bed !== bed) {
        const wasInBed = entity.spot === entity.bed;
        entity.bed = bed;
        if (wasInBed) entity.spot = null;
      }
      if (entity.seat !== seat) {
        const wasAtDesk = entity.spot === entity.seat;
        entity.seat = seat;
        if (wasAtDesk) entity.spot = null;
      }
    }
    entity.retarget(book);
  }
  refreshPanels();
}

function notifyTransition(agent, prev, next) {
  if (prev === next) return;
  const style = styleFor(agent);
  const open = { label: 'Open', fn: () => app.openAgent(agent.id) };
  if (next === 'question') {
    chime('question');
    toast({ title: `🙋 ${agent.name} has a question`, text: agent.status.detail, accent: style.color, agent, action: open });
  } else if (next === 'conflict') {
    chime('conflict');
    toast({ title: `⚔️ ${agent.name} hit a merge conflict`, text: agent.status.detail, accent: '#F87171', agent, action: open });
  } else if (agent.role === 'assistant' && app.reportPending && prev === 'working' && next !== 'offline') {
    app.reportPending = false;
    chime('question');
    toast({ title: '📋 Your progress report is ready', text: `${agent.name} finished the rounds.`, accent: style.color, agent, action: open, ttl: 15000 });
  }
}

function onStatus({ id, status, running }) {
  const prev = app.agents.get(id);
  if (!prev) return;
  const agent = { ...prev, status, running };
  app.agents.set(id, agent);
  const entity = app.entities.get(id);
  if (entity) {
    entity.sync(agent);
    entity.retarget(book);
  }
  notifyTransition(agent, prev.status?.state, status.state);
  refreshPanels();
}

// ── app actions ─────────────────────────────────────────────────────────────
function refreshPanels() {
  const list = [...app.agents.values()];
  roster?.render(list, drawer?.active);
  hud?.render(list, app.memory);
  drawer?.refresh();
}

// ── relationships ───────────────────────────────────────────────────────────
function pairKey(a, b) {
  return [a, b].sort().join('|');
}

app.relationship = (a, b) => app.relationships.get(pairKey(a, b)) || null;

function setRelationships(pairs) {
  app.relationships = new Map(pairs.map((p) => [p.key, p]));
}

const DRAMA = {
  sweethearts: (a, b) => `💕 ${a} & ${b} are now sweethearts!`,
  crush: (a, b) => `💗 ${a} & ${b} have a crush on each other…`,
  bestfriends: (a, b) => `💛 ${a} & ${b} are best friends now`,
  friends: (a, b) => `🤝 ${a} & ${b} became friends`,
  coworkers: (a, b) => `🙂 ${a} & ${b} are just coworkers again`,
  rivals: (a, b) => `⚔️ ${a} & ${b} are rivals now`,
  enemies: (a, b) => `😤 ${a} & ${b} can't stand each other`,
};

function onRelationship(msg) {
  const { key, a, b, affinity, romance, interactions, updatedAt, label, prevLabel, changed } = msg;
  app.relationships.set(key, { key, a, b, affinity, romance, interactions, updatedAt, label });
  if (!changed) return;
  const A = app.agents.get(a);
  const B = app.agents.get(b);
  if (!A || !B) return;
  const warmer = ['friends', 'bestfriends', 'crush', 'sweethearts'].includes(label.key);
  toast({
    title: DRAMA[label.key]?.(A.name, B.name) || `${A.name} & ${B.name}: ${label.label}`,
    text: `Office gossip · was ${prevLabel.emoji} ${prevLabel.label}`,
    accent: warmer ? '#F472B6' : '#F87171',
    agent: A,
  });
  for (const id of [a, b]) app.entities.get(id)?.think(label.emoji, 3);
  drawer?.refresh();
}

/** Asks the server's local-model writer for this chat; resolves to null to use the scripts. */
async function writeDialogue(a, b, room) {
  const result = await api('POST', '/api/social/dialogue', { a, b, room });
  return result.source === 'llm' ? result : null;
}

function reportInteraction(a, b, kind, { lines = [], room, ticket } = {}) {
  api('POST', '/api/relationships/interact', { a, b, kind, lines, room, ticket })
    .catch((err) => console.warn('[social] interaction not recorded', err.message));
}

function staff(role) {
  return [...app.agents.values()].find((a) => a.role === role);
}

app.openAgent = (id) => drawer.openAgent(id);
app.openHire = () => hire.open();
app.openSettings = () => settingsDialog.open();
app.openCustomizer = () => customizer.open();
app.applyManagerLook = (look) => manager?.setLook(look);
app.onDrawerChange = () => roster?.render([...app.agents.values()], drawer.active);
app.walkToRoom = (room) => {
  const c = ROOMS[room].center;
  if (manager.walkTo(c.x, c.y, 1)) renderer.flashMarker(c.x, c.y, performance.now() / 1000);
};

app.goToFloor = (floor) => {
  if (manager.floor === floor) return;
  if (!manager.travelTo(floor)) toast({ title: 'The elevator is busy', text: 'Try again in a moment.' });
};

function renderFloorSwitch() {
  for (const btn of document.querySelectorAll('[data-floor]')) {
    btn.classList.toggle('active', Number(btn.dataset.floor) === manager.floor);
  }
}

app.requestReport = async () => {
  const assistant = staff('assistant');
  if (!assistant) return;
  app.reportPending = true;
  try {
    await api('POST', `/api/agents/${assistant.id}/say`, { text: REPORT_PROMPT });
    app.entities.get(assistant.id)?.say('On it, boss! 📋', 3);
    drawer.openAgent(assistant.id);
  } catch (err) {
    app.reportPending = false;
    toast({ title: "Couldn't reach your Assistant Manager", text: err.message, accent: '#F87171' });
  }
};

app.askHr = () => {
  const hr = staff('hr');
  if (!hr) return;
  app.entities.get(hr.id)?.say('Who should we hire? 💐', 3);
  drawer.openAgent(hr.id);
  if (hr.running) setTimeout(() => socket.send({ t: 'input', id: hr.id, data: "I'd like to hire " }), 250);
};

app.clockInAll = async () => {
  try {
    const { started, skipped } = await api('POST', '/api/start-all');
    const missing = skipped.length ? `${skipped.length} need a CLI install — open them to install.` : '';
    toast({ title: `▶ ${started.length} agents clocked in`, text: missing });
  } catch (err) {
    toast({ title: 'Clock-in failed', text: err.message, accent: '#F87171' });
  }
};

// ── input ───────────────────────────────────────────────────────────────────
const keys = new Set();

function typingInUi(target) {
  return Boolean(target?.closest?.('.xterm, input, textarea, select, dialog, [contenteditable="true"]'));
}

function nearestAgent(maxDist) {
  let best = null;
  let bestDist = maxDist;
  for (const a of app.entities.values()) {
    if (a.floor !== manager.floor || a.hidden) continue;
    const d = Math.hypot(a.x - manager.x, a.y - manager.y);
    if (d < bestDist) {
      best = a;
      bestDist = d;
    }
  }
  return best;
}

window.addEventListener('keydown', (e) => {
  if (typingInUi(e.target) || e.metaKey || e.ctrlKey || !manager) return;
  const key = e.key.toLowerCase();
  if (Object.values(MOVE_KEYS).some((ks) => ks.includes(key))) {
    keys.add(key);
    e.preventDefault();
  } else if (key === 'escape' && drawer.isOpen) {
    drawer.close();
  } else if (key === 'e') {
    const atElevator = Math.hypot(manager.x - ELEVATOR.x, manager.y - ELEVATOR.y) < TALK_RANGE;
    const near = nearestAgent(TALK_RANGE);
    if (near) app.openAgent(near.id);
    else if (atElevator) app.goToFloor(manager.floor === 1 ? 2 : 1);
  } else if (key === ' ') {
    renderer.pan = { x: 0, y: 0 };
    e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());

function held(dir) {
  return MOVE_KEYS[dir].some((k) => keys.has(k));
}

let press = null;
canvas.addEventListener('pointerdown', (e) => {
  press = { x: e.clientX, y: e.clientY, panX: renderer.pan.x, panY: renderer.pan.y, dragging: false };
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  if (press) {
    const dx = e.clientX - press.x;
    const dy = e.clientY - press.y;
    if (!press.dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) press.dragging = true;
    if (press.dragging) {
      renderer.pan = { x: press.panX - dx / renderer.zoom, y: press.panY - dy / renderer.zoom };
      canvas.className = 'grabbing';
      return;
    }
  }
  hover = renderer.pick(e.clientX, e.clientY, { agents: [...app.entities.values()], viewFloor: manager?.floor });
  canvas.className = hover ? 'pointer' : '';
});

canvas.addEventListener('pointerup', (e) => {
  const wasDrag = press?.dragging;
  press = null;
  canvas.className = hover ? 'pointer' : '';
  if (wasDrag || !manager) return;
  const hit = renderer.pick(e.clientX, e.clientY, { agents: [...app.entities.values()], viewFloor: manager.floor });
  if (renderer.pickManager(e.clientX, e.clientY, manager)) {
    app.openCustomizer();
  } else if (hit?.type === 'agent') {
    app.openAgent(hit.id);
  } else if (hit?.type === 'memory') {
    drawer.openMemory();
  } else {
    const w = renderer.screenToWorld(e.clientX, e.clientY, manager.floor);
    if (manager.walkTo(w.x, w.y)) renderer.flashMarker(w.x, w.y, performance.now() / 1000);
  }
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  renderer.setZoom(renderer.zoom * Math.exp(-e.deltaY * ZOOM_STEP));
}, { passive: false });

window.addEventListener('resize', () => renderer.resize());

// ── socket ──────────────────────────────────────────────────────────────────
socket.on('agents', ({ agents }) => manager && syncAgents(agents));
socket.on('status', onStatus);
socket.on('clis', ({ clis }) => {
  app.clis = clis;
  refreshPanels();
});
socket.on('memory', ({ memory }) => {
  app.memory = memory;
  refreshPanels();
});
socket.on('settings', ({ settings }) => {
  app.settings = settings;
  app.applyManagerLook(settings.manager?.look);
});
socket.on('relationship', onRelationship);
socket.on('feed', ({ entry }) => drawer?.onFeedEntry(entry));
socket.on('chat', ({ message }) => {
  drawer?.onChatMessage(message);
  // The poster says it out loud, briefly, wherever they are.
  const speaker = app.entities.get(message.from);
  if (speaker && !speaker.convo) speaker.say(message.text.length > 60 ? `${message.text.slice(0, 58)}…` : message.text, 5);
});
socket.on('relationships', ({ pairs }) => setRelationships(pairs));
socket.on('hired', ({ id, by }) => {
  if (!app.entities.has(id)) app.pendingHires.add(id);
  setTimeout(() => {
    const agent = app.agents.get(id);
    if (!agent) return;
    toast({ title: `🎉 ${by} hired ${agent.name}!`, text: `${agent.team} · ${agent.persona.emoji} ${agent.persona.title}`, accent: styleFor(agent).color, agent });
  }, 200);
});
socket.on('sanctioned', ({ id, level, reason, by, until }) => {
  const agent = app.agents.get(id);
  const name = agent?.name || 'An agent';
  const title = level === 'suspension'
    ? `⛔ ${by} suspended ${name} until ${new Date(until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : `⚠️ ${by} warned ${name}`;
  toast({ title, text: reason, accent: level === 'suspension' ? '#F87171' : '#F59E0B', agent, ttl: 20000 });
});
socket.on('pr-merged', ({ by, number, title }) => {
  toast({ title: `🔀 ${by} merged #${number}`, text: title, ttl: 12000 });
});
socket.on('policy-rejected', ({ file }) => {
  toast({
    title: '🔒 Blocked a sandbox change', accent: '#F87171', ttl: 30000,
    text: `An agent wrote a Cursor sandbox policy into the workspace. It was moved aside to ${file} and never applied. Check who wrote it.`,
  });
});
socket.on('install-done', (msg) => drawer?.onInstallDone(msg));
socket.on('exit', ({ id }) => {
  const agent = app.agents.get(id);
  if (agent) app.agents.set(id, { ...agent, running: false });
  refreshPanels();
});

// ── loop ────────────────────────────────────────────────────────────────────
let last = performance.now();
let lastHud = 0;
let lastFloor = 0;

// Keep the laptop cool: 30 fps while you're looking, 8 fps when the window isn't focused.
const FRAME_MS_FOCUSED = 1000 / 30;
const FRAME_MS_BACKGROUND = 1000 / 8;

function frame(now) {
  const budget = document.hasFocus() ? FRAME_MS_FOCUSED : FRAME_MS_BACKGROUND;
  if (now - last < budget - 1) {
    requestAnimationFrame(frame);
    return;
  }
  const dt = Math.min(0.15, (now - last) / 1000);
  last = now;
  const t = now / 1000;
  manager.setInput(held('up'), held('down'), held('left'), held('right'));
  manager.update(dt);
  if (manager.walking) {
    const k = Math.exp(-dt * PAN_DECAY);
    renderer.pan = { x: renderer.pan.x * k, y: renderer.pan.y * k };
  }
  const agents = [...app.entities.values()];
  for (const a of agents) a.update(dt, t, manager);
  social.update(dt, t, agents, {
    managerName: app.managerName,
    memoryConnected: Boolean(app.memory.connected),
    relationship: app.relationship,
    report: reportInteraction,
    writeDialogue: app.settings.writer?.mode === 'llm' ? writeDialogue : null,
  });
  renderer.follow(manager, dt);
  const seatOwners = new Map(agents.map((a) => [a.seat, a]));
  const bedOwners = new Map(agents.map((a) => [a.bed, a]));
  if (manager.floor !== lastFloor) {
    lastFloor = manager.floor;
    renderFloorSwitch();
    hover = null;
  }
  renderer.render({
    t,
    manager,
    agents,
    viewFloor: manager.floor,
    relationship: app.relationship,
    hoverId: hover?.type === 'agent' ? hover.id : null,
    selectedId: drawer.isOpen ? drawer.active : null,
    env: {
      t,
      ownerOf: (seat) => seatOwners.get(seat) || null,
      bedOwnerOf: (spot) => bedOwners.get(spot) || null,
      memory: app.memory,
      conflictActive: agents.some((a) => a.state === 'conflict'),
      elevatorBusy: Boolean(manager.ride) || agents.some((a) => a.ride),
      hover: hover?.type === 'memory' ? 'memory' : null,
    },
  });
  if (now - lastHud > HUD_EVERY_MS) {
    lastHud = now;
    hud.render([...app.agents.values()], app.memory);
  }
  requestAnimationFrame(frame);
}

async function boot() {
  const state = await api('GET', '/api/state');
  app.clis = state.clis;
  app.memory = state.memory;
  app.settings = state.settings || {};
  setRelationships(state.relationships || []);
  app.personalities = state.personalities;
  app.defaultCwd = state.defaultCwd;
  app.managerName = state.manager.name;
  manager = new Manager(app.managerName, app.settings.manager?.look);
  drawer = new Drawer({ app, pool, toast });
  app.drawer = drawer;
  hud = new Hud(app);
  roster = new Roster(app);
  hire = new HireDialog(app);
  settingsDialog = new SettingsDialog(app);
  customizer = new Customizer(app);
  document.getElementById('btn-look').addEventListener('click', () => app.openCustomizer());
  document.getElementById('btn-feed').addEventListener('click', () => drawer.openFeed());
  const chatButton = document.getElementById('btn-chat');
  chatButton.addEventListener('click', () => drawer.openChat());
  drawer.chat.onUnread = (count) => {
    chatButton.querySelector('.hud-badge')?.remove();
    if (count) chatButton.append(Object.assign(document.createElement('span'), { className: 'hud-badge', textContent: count > 99 ? '99+' : String(count) }));
  };
  for (const btn of document.querySelectorAll('[data-floor]')) {
    btn.addEventListener('click', () => app.goToFloor(Number(btn.dataset.floor)));
  }
  syncAgents(state.agents);
  // Opt-in debug handle for poking at the scene from devtools: /?debug
  if (new URLSearchParams(location.search).has('debug')) window.plexi = { app, book, social, renderer, manager };
  requestAnimationFrame(frame);
}

// Reload when the office's page files change, so an open tab never runs stale code.
const VERSION_POLL_MS = 30_000;
let pageVersion = null;

function busyEditing() {
  const active = document.activeElement;
  return Boolean(document.querySelector('dialog[open]') || active?.matches?.('input, textarea, select'));
}

async function checkForUpdate() {
  try {
    const { version } = await api('GET', '/api/version');
    if (pageVersion === null) {
      pageVersion = version;
    } else if (version !== pageVersion && !busyEditing()) {
      toast({ title: '✨ The office was updated', text: 'Reloading…' });
      setTimeout(() => location.reload(), 1200);
    }
  } catch {
    // server restarting; try again next time
  }
}
checkForUpdate();
setInterval(checkForUpdate, VERSION_POLL_MS);

boot().catch((err) => {
  console.error(err);
  toast({ title: "The office didn't open", text: err.message, accent: '#F87171', ttl: 60000 });
});
