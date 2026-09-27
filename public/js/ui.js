// HUD chips, roster, toasts, hire dialog and a gentle chime.
import { api } from './net.js';
import { STATE_LABELS, el, portrait } from './drawer.js';
import { ROLE_STYLE, TEAMS, styleFor } from './world.js';

const TOAST_MS = 7000;
const MAX_TOASTS = 4;
const CUTE_NAMES = ['Yuzu', 'Miso', 'Tofu', 'Suki', 'Kumo', 'Hana', 'Riku', 'Momo', 'Pixel', 'Noodle', 'Biscuit', 'Mango',
  'Sprout', 'Pebble', 'Waffle', 'Boba', 'Clover', 'Juno', 'Ziggy', 'Onigiri', 'Peanut', 'Sesame', 'Kiko', 'Dango'];

const CHIPS = [
  { state: 'working', icon: '💻', label: 'Working' },
  { state: 'break', icon: '☕', label: 'On break' },
  { state: 'question', icon: '🙋', label: 'Questions', urgent: 'urgent', room: 'manager', roomName: "Manager's Office" },
  { state: 'conflict', icon: '⚔️', label: 'Conflicts', urgent: 'urgent-red', room: 'conflict', roomName: 'Merge Conflict Room' },
  { state: 'offline', icon: '💤', label: 'Off the clock' },
];

// ── toasts ──────────────────────────────────────────────────────────────────
export function createToaster(container) {
  return function toast({ title, text = '', accent, agent, action, ttl = TOAST_MS }) {
    const node = el('div', { class: 'toast', style: accent ? `--accent:${accent}` : '' },
      agent ? portrait(agent, 34) : null,
      el('div', { class: 'msg' }, el('b', {}, title), text ? el('span', { title: text }, text) : null));
    if (action) {
      node.append(el('button', { class: 'btn btn-sm', onclick: () => { action.fn(); node.remove(); } }, action.label));
    }
    node.append(el('button', { class: 'btn btn-sm btn-ghost', 'aria-label': 'Dismiss', onclick: () => node.remove() }, '×'));
    container.prepend(node);
    while (container.children.length > MAX_TOASTS) container.lastChild.remove();
    setTimeout(() => node.remove(), ttl);
  };
}

let audio;
export function chime(kind = 'question') {
  try {
    audio = audio || new AudioContext();
    const notes = kind === 'conflict' ? [440, 349] : [660, 880];
    notes.forEach((freq, i) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t0 = audio.currentTime + i * 0.13;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
      osc.connect(gain).connect(audio.destination);
      osc.start(t0);
      osc.stop(t0 + 0.4);
    });
  } catch {
    // audio is a nicety; browsers may block it until the first click
  }
}

// ── HUD ─────────────────────────────────────────────────────────────────────
export class Hud {
  constructor(app) {
    this.app = app;
    this.chipsEl = document.getElementById('status-chips');
    this.memoryChip = document.getElementById('chip-memory');
    this.clockEl = document.getElementById('clock');
    this.memoryChip.addEventListener('click', () => app.drawer.openMemory());
    document.getElementById('btn-report').addEventListener('click', () => app.requestReport());
    document.getElementById('btn-hire').addEventListener('click', () => app.openHire());
    document.getElementById('btn-clockin').addEventListener('click', () => app.clockInAll());
    document.getElementById('btn-settings').addEventListener('click', () => app.openSettings());
  }

  render(agents, memory) {
    const counts = Object.fromEntries(CHIPS.map((c) => [c.state, 0]));
    for (const a of agents) counts[a.status?.state || 'offline']++;
    this.chipsEl.replaceChildren(...CHIPS.map((c) => {
      const n = counts[c.state];
      return el('button', {
        class: `chip${c.urgent && n ? ` ${c.urgent}` : ''}`,
        title: c.room ? `Walk to the ${c.roomName}` : c.label,
        onclick: () => c.room && this.app.walkToRoom(c.room),
        'aria-label': `${n} ${c.label}`,
      }, c.icon, el('span', { class: 'count' }, n), el('span', { class: 'lbl' }, c.label));
    }));
    this.memoryChip.classList.toggle('on', Boolean(memory?.connected));
    this.memoryChip.classList.toggle('warn', Boolean(memory?.running && !memory?.connected));
    let label = 'Memory off';
    if (memory?.connected) label = 'Memory on';
    else if (memory?.running) label = 'Memory: needs key';
    this.memoryChip.querySelector('.label').textContent = label;
    const now = new Date();
    this.clockEl.textContent = `${now.toLocaleDateString(undefined, { weekday: 'long' })} · ${now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    const waiting = counts.question + counts.conflict;
    document.title = waiting ? `(${waiting}) Plexi Office` : 'Plexi Office';
  }
}

// ── roster ──────────────────────────────────────────────────────────────────
export class Roster {
  constructor(app) {
    this.app = app;
    this.root = document.getElementById('roster');
    this.body = document.getElementById('roster-body');
    this.lastKey = '';
    const toggle = document.getElementById('roster-toggle');
    toggle.addEventListener('click', () => {
      const collapsed = this.root.classList.toggle('collapsed');
      toggle.setAttribute('aria-expanded', String(!collapsed));
    });
  }

  render(agents, activeId) {
    const key = JSON.stringify(agents.map((a) => [a.id, a.name, a.status?.state, a.status?.detail, a.look?.seed])) + activeId;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const groups = [
      { label: 'Office staff', color: ROLE_STYLE.assistant.color, members: agents.filter((a) => a.role !== 'worker') },
      ...Object.entries(TEAMS).map(([type, t]) => ({
        label: t.label, color: t.color, members: agents.filter((a) => a.role === 'worker' && a.type === type),
      })),
    ];
    this.body.replaceChildren(...groups.flatMap((g) => [
      el('div', { class: 'team-head' }, el('span', { class: 'swatch', style: `background:${g.color}` }), `${g.label} · ${g.members.length}`),
      ...g.members.map((a) => this.row(a, activeId)),
    ]));
  }

  row(a, activeId) {
    const state = a.status?.state || 'offline';
    const sub = a.status?.detail || (a.role === 'worker' ? a.persona?.title : a.roleLabel) || '';
    return el('button', { class: `person${a.id === activeId ? ' active' : ''}`, onclick: () => this.app.openAgent(a.id), title: `Open ${a.name}'s terminal` },
      portrait(a, 32, state === 'offline' ? 'sleep' : 'happy'),
      el('span', { class: 'who' },
        el('span', { class: 'nm' }, el('span', { class: `state-dot state-${state}` }), a.name),
        el('span', { class: 'st' }, `${STATE_LABELS[state]}${sub ? ` · ${sub}` : ''}`)));
  }
}

// ── hire dialog ─────────────────────────────────────────────────────────────
export class HireDialog {
  constructor(app) {
    this.app = app;
    this.dialog = document.getElementById('hire-dialog');
    this.form = document.getElementById('hire-form');
    this.nameInput = document.getElementById('hire-name');
    this.cwdInput = document.getElementById('hire-cwd');
    this.persona = document.getElementById('hire-personality');
    this.teams = document.getElementById('hire-teams');
    this.error = document.getElementById('hire-error');
    document.getElementById('hire-dice').addEventListener('click', () => { this.nameInput.value = this.randomName(); });
    document.getElementById('hire-cancel').addEventListener('click', () => this.dialog.close());
    document.getElementById('hire-ask-hr').addEventListener('click', () => {
      this.dialog.close();
      app.askHr();
    });
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit();
    });
  }

  randomName() {
    const taken = new Set([...this.app.agents.values()].map((a) => a.name.toLowerCase()));
    const free = CUTE_NAMES.filter((n) => !taken.has(n.toLowerCase()));
    return free[Math.floor(Math.random() * free.length)] || `Agent${Math.floor(Math.random() * 900 + 100)}`;
  }

  open() {
    this.error.textContent = '';
    this.nameInput.value = this.randomName();
    this.cwdInput.value = this.app.defaultCwd;
    this.persona.replaceChildren(el('option', { value: '' }, '🎲 Surprise me'),
      ...this.app.personalities.map((p) => el('option', { value: p.key }, `${p.emoji} ${p.title} — ${p.traits.join(', ')}`)));
    const cards = Object.entries(TEAMS).map(([type, t], i) => {
      const cli = this.app.clis[type];
      return el('label', { class: 'team-card', style: `--team:${t.color}` },
        el('input', { type: 'radio', name: 'type', value: type, checked: i === 0 }),
        el('b', { style: `color:${t.color}` }, `${t.icon} ${t.label}`),
        el('small', {}, cli?.installed ? `${cli.bin} ✓` : `${cli?.bin || type} — installs on first open`));
    });
    this.teams.replaceChildren(el('legend', {}, 'Team'), ...cards);
    this.dialog.showModal();
    this.nameInput.select();
  }

  async submit() {
    const data = new FormData(this.form);
    try {
      const agent = await api('POST', '/api/agents', {
        name: data.get('name'),
        type: data.get('type'),
        cwd: data.get('cwd'),
        personality: data.get('personality') || undefined,
      });
      this.dialog.close();
      this.app.toast({ title: `🎉 Welcome, ${agent.name}!`, text: `${agent.team} · ${agent.persona.emoji} ${agent.persona.title}`, accent: styleFor(agent).color });
    } catch (err) {
      this.error.textContent = err.message;
    }
  }
}

// ── settings dialog ─────────────────────────────────────────────────────────
export class SettingsDialog {
  constructor(app) {
    this.app = app;
    this.dialog = document.getElementById('settings-dialog');
    for (const radio of document.querySelectorAll('input[name="perm-preset"]')) {
      radio.addEventListener('change', () => this.syncPermissionFields());
    }
    for (const radio of document.querySelectorAll('input[name="writer-mode"]')) {
      radio.addEventListener('change', () => this.syncWriterFields());
    }
    const url = document.getElementById('writer-url');
    document.getElementById('writer-lmstudio').addEventListener('click', () => {
      url.value = 'http://localhost:1234/v1';
      this.loadWriterModels();
    });
    document.getElementById('writer-memory').addEventListener('click', () => {
      const m = this.app.settings.memoryLlm || {};
      if (!m.baseUrl) {
        this.error.textContent = 'The Memory Vault has no model set yet.';
        return;
      }
      url.value = m.baseUrl;
      this.loadWriterModels(m.model);
    });
    document.getElementById('writer-load').addEventListener('click', () => this.loadWriterModels());
    this.form = document.getElementById('settings-form');
    this.error = document.getElementById('settings-error');
    document.getElementById('settings-cancel').addEventListener('click', () => this.dialog.close());
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.save();
    });
  }

  open() {
    const b = this.app.settings.breaks || { enabled: true, workMinutes: 15, breakMinutes: 3 };
    document.getElementById('set-breaks-enabled').checked = b.enabled;
    document.getElementById('set-work').value = b.workMinutes;
    document.getElementById('set-break').value = b.breakMinutes;
    document.getElementById('set-romance').checked = this.app.settings.social?.romance !== false;
    const perms = this.app.settings.permissions || {};
    const preset = perms.preset || 'safe';
    for (const radio of document.querySelectorAll('input[name="perm-preset"]')) radio.checked = radio.value === preset;
    document.getElementById('perm-accept-edits').checked = perms.acceptEdits !== false;
    document.getElementById('perm-allow').value = (perms.allow || []).join('\n');
    document.getElementById('perm-deny').value = (perms.deny || []).join('\n');
    document.getElementById('perm-codex-sandbox').value = perms.codexSandbox || 'workspace-write';
    document.getElementById('perm-codex-approval').value = perms.codexApproval || 'on-request';
    this.syncPermissionFields();
    const writer = this.app.settings.writer || {};
    for (const radio of document.querySelectorAll('input[name="writer-mode"]')) radio.checked = radio.value === (writer.mode || 'script');
    document.getElementById('writer-url').value = writer.baseUrl || '';
    document.getElementById('writer-every').value = String(writer.everySeconds || 120);
    const select = document.getElementById('writer-model');
    select.replaceChildren(el('option', { value: writer.model || '' }, writer.model || 'Pick a server, then Load models'));
    this.syncWriterFields();
    this.error.textContent = '';
    this.dialog.showModal();
  }

  writerMode() {
    return document.querySelector('input[name="writer-mode"]:checked')?.value || 'script';
  }

  syncWriterFields() {
    document.getElementById('writer-llm').hidden = this.writerMode() !== 'llm';
  }

  async loadWriterModels(prefer) {
    const baseUrl = document.getElementById('writer-url').value.trim();
    const select = document.getElementById('writer-model');
    if (!baseUrl) {
      this.error.textContent = 'Enter a model server URL first (or click LM Studio).';
      return;
    }
    try {
      const { models } = await api('GET', `/api/memory/llm/models?baseUrl=${encodeURIComponent(baseUrl)}`);
      const chat = models.filter((id) => !/embed/i.test(id));
      const current = prefer || this.app.settings.writer?.model;
      select.replaceChildren(...(chat.length ? chat : ['']).map((id) => el('option', { value: id, selected: id === current }, id || 'No chat models loaded')));
      this.error.textContent = '';
    } catch (err) {
      this.error.textContent = err.message;
    }
  }

  selectedPreset() {
    return document.querySelector('input[name="perm-preset"]:checked')?.value || 'safe';
  }

  syncPermissionFields() {
    document.getElementById('perm-custom').hidden = this.selectedPreset() !== 'custom';
  }

  readPermissions() {
    const lines = (id) => document.getElementById(id).value.split('\n').map((l) => l.trim()).filter(Boolean);
    const preset = this.selectedPreset();
    if (preset !== 'custom') return { preset };
    return {
      preset,
      acceptEdits: document.getElementById('perm-accept-edits').checked,
      allow: lines('perm-allow'),
      deny: lines('perm-deny'),
      codexSandbox: document.getElementById('perm-codex-sandbox').value,
      codexApproval: document.getElementById('perm-codex-approval').value,
    };
  }

  async save() {
    try {
      this.app.settings = await api('PATCH', '/api/settings', {
        breaks: {
          enabled: document.getElementById('set-breaks-enabled').checked,
          workMinutes: Number(document.getElementById('set-work').value),
          breakMinutes: Number(document.getElementById('set-break').value),
        },
        social: { romance: document.getElementById('set-romance').checked },
        permissions: this.readPermissions(),
      });
      this.app.settings = {
        ...this.app.settings,
        writer: await api('PATCH', '/api/settings/writer', {
          mode: this.writerMode(),
          baseUrl: document.getElementById('writer-url').value.trim(),
          model: document.getElementById('writer-model').value,
          everySeconds: Number(document.getElementById('writer-every').value),
        }),
      };
      this.dialog.close();
      const b = this.app.settings.breaks;
      this.app.toast({ title: '⚙️ Saved', text: b.enabled ? `Breaks: ${b.breakMinutes} min after every ${b.workMinutes} min of work` : 'Scheduled breaks are off' });
    } catch (err) {
      this.error.textContent = err.message;
    }
  }
}
