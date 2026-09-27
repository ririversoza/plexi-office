// The right-hand drawer: agent terminals, CLI installs, Memory Vault, memories.
import { api } from './net.js';
import { drawPortrait, makeLook } from './chibi.js';
import { styleFor } from './world.js';
import { ChatPanel } from './chat-panel.js';

export const STATE_LABELS = {
  working: 'Working',
  break: 'On break',
  question: 'Waiting on you',
  conflict: 'In the Merge Conflict Room',
  offline: 'Off the clock',
};
const MEMORY_TAB = 'memory';
const FEED_TAB = 'feed';
const CHAT_TAB = 'chat';
const FEED_FILTERS = [['all', 'All'], ['report', '📝 Reports'], ['gossip', '💞 Gossip'], ['chat', '💬 Chats'], ['hr', '📋 HR']];
const SANCTION_ICONS = { warning: '⚠️', suspension: '⛔', lifted: '✅' };
const ROOM_LABELS = { break: '☕ Break Room', conflict: '⚔ Merge Conflict Room' };

function ago(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(ms).toLocaleDateString();
}
const RESTART_WAIT_MS = 4000;
const ERROR_ACCENT = '#F87171';

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'style') node.style.cssText = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c != null && c !== false) node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function portrait(agent, size = 56, expression = 'happy') {
  const canvas = el('canvas', { style: `width:${size}px;height:${size}px`, 'aria-hidden': 'true' });
  requestAnimationFrame(() => {
    const look = makeLook(agent.look?.seed, { type: agent.type, role: agent.role, badge: styleFor(agent).color });
    drawPortrait(canvas, look, { expression });
  });
  return canvas;
}

export class Drawer {
  constructor({ app, pool, toast }) {
    this.app = app;
    this.pool = pool;
    this.toast = toast;
    this.root = document.getElementById('drawer');
    this.tabsEl = document.getElementById('drawer-tabs');
    this.headEl = document.getElementById('drawer-head');
    this.panelEl = document.getElementById('drawer-panel');
    this.tabs = [];
    this.active = null;
    this.panelMode = null;
    this.pendingInstall = null;
    this.memoryInstalling = false;
    this.feedEntries = null;
    this.feedFilter = 'all';
    this.chat = new ChatPanel(app, { openAgent: (id) => this.openAgent(id) });
  }

  get isOpen() {
    return !this.root.hidden;
  }

  show() {
    this.root.hidden = false;
    this.app.onDrawerChange();
  }

  close() {
    this.root.hidden = true;
    this.pool.hideAll();
    this.active = null;
    this.app.onDrawerChange();
  }

  addTab(id) {
    if (!this.tabs.includes(id)) this.tabs = [...this.tabs, id];
  }

  closeTab(id) {
    this.tabs = this.tabs.filter((t) => t !== id);
    if (this.active !== id) {
      this.renderTabs();
      return;
    }
    const next = this.tabs.at(-1);
    if (next === MEMORY_TAB) this.openMemory();
    else if (next === FEED_TAB) this.openFeed();
    else if (next === CHAT_TAB) this.openChat();
    else if (next) this.openAgent(next);
    else this.close();
  }

  renderTabs() {
    const tabs = this.tabs.map((id) => {
      const agent = this.app.agents.get(id);
      const label = { [MEMORY_TAB]: '🧠 Memory Vault', [FEED_TAB]: '📰 Office feed', [CHAT_TAB]: '💬 Group chat' }[id] || agent?.name || id;
      const close = el('span', { class: 'x', title: 'Close tab' }, '×');
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeTab(id);
      });
      return el('button', {
        class: `tab${id === this.active ? ' active' : ''}`,
        onclick: () => {
          if (id === MEMORY_TAB) this.openMemory();
          else if (id === FEED_TAB) this.openFeed();
          else if (id === CHAT_TAB) this.openChat();
          else this.openAgent(id);
        },
      }, agent ? el('span', { class: `state-dot state-${agent.status?.state || 'offline'}` }) : null, label, close);
    });
    this.tabsEl.replaceChildren(...tabs, el('span', { class: 'spacer' }),
      el('button', { class: 'tab', title: 'Hide the terminal — agents keep working', onclick: () => this.close() }, '⤫ Hide'));
  }

  showPanel(content, { full = false } = {}) {
    this.panelEl.replaceChildren(content);
    this.panelEl.hidden = false;
    this.panelEl.classList.toggle('full', full);
    requestAnimationFrame(() => this.pool.fitActive());
  }

  hidePanel() {
    this.panelEl.hidden = true;
    this.panelEl.classList.remove('full'); // the feed's full-height mode must not hide agent terminals
    this.panelEl.replaceChildren();
    requestAnimationFrame(() => this.pool.fitActive());
  }

  // ── agents ────────────────────────────────────────────────────────────
  async openAgent(id) {
    const agent = this.app.agents.get(id);
    if (!agent) return;
    this.addTab(id);
    this.active = id;
    this.panelMode = null;
    this.show();
    this.renderTabs();
    this.renderAgentHead(agent);
    this.hidePanel();
    this.pool.show(id);
    if (!agent.running) await this.startOrInstall(agent);
  }

  async startOrInstall(agent) {
    if (!this.app.clis[agent.type]?.installed) {
      this.showInstall(agent);
      return;
    }
    try {
      await api('POST', `/api/agents/${agent.id}/start`, this.pool.size(agent.id));
      if (this.active === agent.id) this.pool.show(agent.id);
    } catch (err) {
      if (err.body?.needsInstall) this.showInstall(agent);
      else this.toast({ title: `Couldn't start ${agent.name}`, text: err.message, accent: ERROR_ACCENT });
    }
  }

  async restart(agent) {
    await api('POST', `/api/agents/${agent.id}/stop`);
    const deadline = Date.now() + RESTART_WAIT_MS;
    while (this.app.agents.get(agent.id)?.running && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 120));
    }
    await this.startOrInstall(this.app.agents.get(agent.id));
  }

  showInstall(agent) {
    const cli = this.app.clis[agent.type];
    const installId = `install:${agent.type}`;
    const installBtn = el('button', { class: 'btn btn-gold' }, `Install ${cli.label}`);
    installBtn.addEventListener('click', async () => {
      installBtn.disabled = true;
      try {
        await api('POST', `/api/clis/${agent.type}/install`);
        this.pendingInstall = { target: agent.type, agentId: agent.id };
        this.pool.show(installId);
        this.showPanel(el('div', {},
          el('h3', {}, `Installing ${cli.label}…`),
          el('p', {}, `Follow along below — ${agent.name} clocks in automatically when it finishes.`)));
      } catch (err) {
        installBtn.disabled = false;
        this.toast({ title: 'Install failed to start', text: err.message, accent: ERROR_ACCENT });
      }
    });
    this.showPanel(el('div', {},
      el('h3', {}, `🧰 ${cli.label} isn't installed yet`),
      el('p', {}, `${agent.name} needs the `, el('code', {}, cli.bin), ' CLI. Plexi will run the official installer in a terminal right here:'),
      el('code', { class: 'cmd' }, cli.install),
      el('div', { class: 'row' }, installBtn, el('a', { class: 'btn btn-ghost', href: cli.docs, target: '_blank', rel: 'noopener' }, 'Docs ↗'))));
  }

  async onInstallDone({ target, code, installed }) {
    if (target === 'supermemory') {
      this.memoryInstalling = false;
      if (this.active === MEMORY_TAB) this.openMemory();
      return;
    }
    const pending = this.pendingInstall;
    if (!pending || pending.target !== target) return;
    this.pendingInstall = null;
    const agent = this.app.agents.get(pending.agentId);
    if (installed) {
      this.toast({ title: `${this.app.clis[target].label} installed 🎉`, text: agent ? `${agent.name} is clocking in.` : '' });
      if (agent && this.active === agent.id) {
        this.hidePanel();
        this.pool.show(agent.id);
        await this.startOrInstall(agent);
      }
    } else if (agent && this.active === agent.id) {
      this.showPanel(el('div', {},
        el('h3', {}, '😿 The install did not finish'),
        el('p', {}, `The installer exited with code ${code} and the CLI still isn't on your PATH. Check the output below, then try again.`),
        el('button', { class: 'btn', onclick: () => this.showInstall(agent) }, 'Try again')));
    }
  }

  headActions(agent) {
    const actions = [];
    if (agent.running) {
      actions.push(el('button', { class: 'btn btn-sm', onclick: () => this.restart(agent) }, '⟳ Restart'));
      actions.push(el('button', { class: 'btn btn-sm', onclick: () => api('POST', `/api/agents/${agent.id}/stop`) }, '■ Clock out'));
    } else {
      actions.push(el('button', { class: 'btn btn-sm btn-gold', onclick: () => this.startOrInstall(agent) }, '▶ Clock in'));
    }
    if (agent.role === 'assistant') actions.push(el('button', { class: 'btn btn-sm btn-gold', onclick: () => this.app.requestReport() }, '📋 Report'));
    if (agent.role === 'hr') actions.push(el('button', { class: 'btn btn-sm btn-pink', onclick: () => this.app.openHire() }, '💐 Hire'));
    actions.push(el('button', { class: 'btn btn-sm', onclick: () => this.toggleMemories(agent) }, '🧠 Memories'));
    actions.push(el('button', { class: 'btn btn-sm', onclick: () => this.toggleCanon(agent) }, '📖 Canon'));
    actions.push(el('button', { class: 'btn btn-sm', onclick: () => this.toggleRelationships(agent) }, '💞 Relationships'));
    actions.push(el('button', { class: 'btn btn-sm', onclick: () => this.toggleEdit(agent) }, '✎ Edit'));
    if (agent.role === 'worker') actions.push(el('button', { class: 'btn btn-sm btn-danger', onclick: () => this.letGo(agent) }, 'Let go'));
    return actions;
  }

  renderAgentHead(agent) {
    const style = styleFor(agent);
    this.headEl.style.setProperty('--accent', style.color);
    this.headEl.style.setProperty('--accent-light', style.light);
    this.headEl.style.setProperty('--accent-dark', style.dark);
    const state = agent.status?.state || 'offline';
    const persona = agent.persona || {};
    this.headEl.replaceChildren(
      portrait(agent, 56, state === 'question' ? 'surprised' : 'happy'),
      el('div', { class: 'meta' },
        el('div', { class: 'title' },
          el('h2', {}, agent.name),
          el('span', { class: 'tag' }, agent.role === 'worker' ? agent.team : agent.roleLabel),
          el('span', { class: 'tag' }, this.app.clis[agent.type]?.label || agent.type)),
        el('div', { class: 'persona' }, `${persona.emoji || ''} `, el('b', {}, persona.title || ''), persona.traits ? ` — ${persona.traits.join(', ')}` : ''),
        el('div', { class: 'status-line' },
          el('span', { class: `state-dot state-${state}` }),
          STATE_LABELS[state],
          agent.status?.detail ? el('span', { class: 'detail', title: agent.status.detail }, `· ${agent.status.detail}`) : null),
        el('div', { class: 'cwd', title: agent.cwd }, `📁 ${agent.cwd}`),
        this.sanctionLine(agent)),
      el('div', { class: 'head-actions' }, this.headActions(agent)),
    );
  }

  sanctionLine(agent) {
    const s = agent.sanction;
    if (!s) return null;
    const until = new Date(s.until);
    const when = s.level === 'suspension' ? `suspended until ${until.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : `on a warning until ${until.toLocaleDateString()}`;
    const lift = el('button', {
      class: 'btn btn-sm',
      title: 'Clear this sanction',
      onclick: async () => {
        lift.disabled = true;
        try {
          const { agent: updated } = await api('POST', `/api/agents/${agent.id}/sanctions/lift`);
          this.app.agents.set(agent.id, updated);
          this.renderAgentHead(updated);
        } catch (err) {
          lift.disabled = false;
          lift.textContent = err.message;
        }
      },
    }, 'Lift');
    return el('div', { class: `sanction-line sanction-${s.level}` },
      `${SANCTION_ICONS[s.level]} ${s.by} — ${when}: `, el('span', { class: 'reason', title: s.reason }, s.reason), lift);
  }

  async toggleMemories(agent) {
    if (this.panelMode === 'memories') {
      this.panelMode = null;
      this.hidePanel();
      return;
    }
    this.panelMode = 'memories';
    const title = el('h3', {}, `🧠 ${agent.name}'s memories`);
    this.showPanel(el('div', {}, title, el('p', {}, 'Recalling…')));
    try {
      const { connected, results } = await api('GET', `/api/agents/${agent.id}/memories`);
      if (this.panelMode !== 'memories') return;
      let body;
      if (!connected) {
        body = el('p', {}, 'Supermemory is not connected yet. ', el('button', { class: 'btn btn-sm', onclick: () => this.openMemory() }, 'Open the Memory Vault'));
      } else if (results.length) {
        body = el('ul', { class: 'memories' }, results.map((m) => el('li', {}, el('span', { class: 'sim' }, `${Math.round(m.similarity * 100)}%`), m.text)));
      } else {
        body = el('p', {}, `Nothing yet. ${agent.name} saves memories with `, el('code', {}, 'plexi memory add'), ' and after each finished turn.');
      }
      this.showPanel(el('div', {}, title, body));
    } catch (err) {
      this.showPanel(el('div', {}, el('h3', {}, 'Could not load memories'), el('p', {}, err.message)));
    }
  }

  toggleCanon(agent) {
    if (this.panelMode === 'canon') {
      this.panelMode = null;
      this.hidePanel();
      return;
    }
    this.panelMode = 'canon';
    this.renderCanon(agent, agent.canon || {});
  }

  /** Character sheet editor. `canon` may be a model-written draft that isn't saved yet. */
  renderCanon(agent, canon) {
    const text = (key, placeholder, rows = 0) => {
      const node = rows
        ? el('textarea', { rows, placeholder, 'aria-label': key }, canon[key] || '')
        : el('input', { value: canon[key] || '', placeholder, 'aria-label': key });
      node.dataset.key = key;
      return node;
    };
    const list = (key, placeholder) => {
      const node = el('input', { value: (canon[key] || []).join(', '), placeholder: `${placeholder} (comma separated)`, 'aria-label': key });
      node.dataset.list = key;
      return node;
    };
    const fields = el('div', { class: 'canon-grid' },
      'Pronouns', text('pronouns', 'they/them'),
      'Hometown', text('hometown', 'Where they grew up'),
      'Backstory', text('backstory', 'A few sentences', 3),
      'Hobbies', list('hobbies', 'karaoke, origami'),
      'Likes', list('likes', 'green builds, oat lattes'),
      'Dislikes', list('dislikes', 'flaky tests'),
      'Speech style', text('speechStyle', 'How they talk'),
      'Quirk', text('quirk', 'A little habit'),
      'Secret', text('secret', 'Something only close friends know'),
      'Goal', text('goal', 'What they dream of'));
    const error = el('p', { class: 'form-error' });
    const read = () => {
      const out = {};
      for (const node of fields.querySelectorAll('[data-key]')) out[node.dataset.key] = node.value;
      for (const node of fields.querySelectorAll('[data-list]')) out[node.dataset.list] = node.value.split(',').map((v) => v.trim()).filter(Boolean);
      return out;
    };
    const writeBtn = el('button', { class: 'btn btn-sm' }, '✨ Write with AI');
    writeBtn.addEventListener('click', async () => {
      writeBtn.disabled = true;
      writeBtn.textContent = '✨ Writing… (this can take ~30s)';
      try {
        const { canon: draft } = await api('POST', `/api/agents/${agent.id}/canon/generate`);
        if (this.panelMode === 'canon' && this.active === agent.id) this.renderCanon(agent, { ...draft, pronouns: read().pronouns || draft.pronouns });
      } catch (err) {
        error.textContent = err.message;
        writeBtn.disabled = false;
        writeBtn.textContent = '✨ Write with AI';
      }
    });
    const saveBtn = el('button', { class: 'btn btn-sm btn-gold' }, 'Save canon');
    saveBtn.addEventListener('click', async () => {
      try {
        await api('PATCH', `/api/agents/${agent.id}`, { canon: read() });
        this.panelMode = null;
        this.hidePanel();
        this.toast({ title: `📖 ${agent.name}'s canon saved`, text: 'Their next conversations (and next shift) will use it.' });
      } catch (err) {
        error.textContent = err.message;
      }
    });
    this.showPanel(el('div', {},
      el('h3', {}, `📖 ${agent.name}'s canon`),
      el('p', {}, 'Who they are. Conversations written by your local model follow this, and it flavours how they talk in their terminal.'),
      fields, error,
      el('div', { class: 'row', style: 'margin-top:8px' }, saveBtn, writeBtn)));
  }

  toggleRelationships(agent) {
    if (this.panelMode === 'relationships') {
      this.panelMode = null;
      this.hidePanel();
      return;
    }
    this.panelMode = 'relationships';
    this.renderRelationships(agent);
  }

  renderRelationships(agent) {
    const rows = [...this.app.relationships.values()]
      .filter((r) => r.a === agent.id || r.b === agent.id)
      .map((r) => ({ ...r, other: this.app.agents.get(r.a === agent.id ? r.b : r.a) }))
      .filter((r) => r.other)
      .sort((p, q) => Math.abs(q.affinity) + q.romance - (Math.abs(p.affinity) + p.romance));
    const body = rows.length
      ? el('ul', { class: 'bonds' }, rows.map((r) => el('li', {},
        portrait(r.other, 28),
        el('span', { class: 'who' }, el('b', {}, r.other.name), el('small', {}, `${r.label.emoji} ${r.label.label} · ${r.interactions} chats`)),
        el('span', { class: 'meter', title: `Affinity ${Math.round(r.affinity)}` },
          el('span', { class: r.affinity < 0 ? 'neg' : 'pos', style: `width:${Math.abs(r.affinity) / 2}%;${r.affinity < 0 ? 'right:50%' : 'left:50%'}` })),
        r.romance > 0 ? el('span', { class: 'romance', title: `Romance ${Math.round(r.romance)}` }, '💗'.repeat(Math.ceil(r.romance / 34))) : null)))
      : el('p', {}, `${agent.name} hasn't really gotten to know anyone yet — that happens on breaks.`);
    this.showPanel(el('div', {}, el('h3', {}, `💞 ${agent.name}'s relationships`), body));
  }

  toggleEdit(agent) {
    if (this.panelMode === 'edit') {
      this.panelMode = null;
      this.hidePanel();
      return;
    }
    this.panelMode = 'edit';
    const name = el('input', { value: agent.name, maxlength: 24 });
    const cwd = el('input', { value: agent.cwd, spellcheck: 'false' });
    const persona = el('select', { disabled: agent.role !== 'worker' },
      this.app.personalities.map((p) => el('option', { value: p.key, selected: p.key === agent.personality }, `${p.emoji} ${p.title}`)));
    const error = el('p', { class: 'form-error' });
    const save = el('button', { class: 'btn btn-gold btn-sm' }, 'Save');
    save.addEventListener('click', async () => {
      try {
        await api('PATCH', `/api/agents/${agent.id}`, {
          name: name.value, cwd: cwd.value, ...(agent.role === 'worker' && { personality: persona.value }),
        });
        this.panelMode = null;
        this.hidePanel();
        if (agent.running) this.toast({ title: 'Saved', text: 'Restart the agent to apply a new folder or personality.' });
      } catch (err) {
        error.textContent = err.message;
      }
    });
    this.showPanel(el('div', {},
      el('h3', {}, `✎ Edit ${agent.name}`),
      el('div', { class: 'settings-grid', style: 'grid-template-columns: 110px 1fr' }, 'Name', name, 'Folder', cwd, 'Personality', persona),
      error,
      el('div', { class: 'row', style: 'margin-top:8px' }, save,
        el('button', { class: 'btn btn-sm btn-ghost', onclick: () => api('PATCH', `/api/agents/${agent.id}`, { rerollLook: true }) }, '🎲 New look'))));
  }

  async letGo(agent) {
    if (!window.confirm(`Let ${agent.name} go? Their CLI will be stopped and they'll leave the office.`)) return;
    try {
      await api('DELETE', `/api/agents/${agent.id}`);
      this.pool.dispose(agent.id);
      this.closeTab(agent.id);
    } catch (err) {
      this.toast({ title: "Couldn't let them go", text: err.message, accent: ERROR_ACCENT });
    }
  }

  // ── memory vault ────────────────────────────────────────────────────────
  openMemory() {
    const m = this.app.memory;
    this.addTab(MEMORY_TAB);
    this.active = MEMORY_TAB;
    this.panelMode = null;
    this.show();
    this.renderTabs();
    this.headEl.style.setProperty('--accent', '#7C6CF0');
    let statusText = 'Not running';
    if (m.connected) statusText = `Connected · ${m.url}`;
    else if (m.running) statusText = 'Server running — waiting for an API key';
    this.headEl.replaceChildren(el('div', { class: 'meta' },
      el('div', { class: 'title' }, el('h2', {}, '🧠 Memory Vault'), el('span', { class: 'tag' }, m.label || 'Supermemory Local')),
      el('div', { class: 'persona' }, 'Long-term memory for every agent: each gets their own space, plus shared office notes.'),
      el('div', { class: 'status-line' },
        el('span', { class: `state-dot state-${m.connected ? 'working' : m.running ? 'break' : 'offline'}` }), statusText),
      el('a', { class: 'cwd', href: m.docs, target: '_blank', rel: 'noopener' }, m.docs)));
    this.renderMemorySteps(m);
    this.pool.show(this.memoryInstalling ? 'install:supermemory' : m.serviceId);
  }

  renderMemorySteps(m) {
    const step = (done, n, text, action) => el('li', { class: done ? 'done' : '' },
      el('span', { class: 'n' }, done ? '✓' : n), el('span', {}, text), done ? null : action);
    const installBtn = el('button', { class: 'btn btn-sm btn-gold' }, 'Install');
    installBtn.addEventListener('click', async () => {
      installBtn.disabled = true;
      await api('POST', '/api/memory/install');
      this.memoryInstalling = true;
      this.pool.show('install:supermemory');
    });
    const startBtn = el('button', { class: 'btn btn-sm btn-gold' }, 'Start server');
    startBtn.addEventListener('click', async () => {
      try {
        this.pool.show(m.serviceId);
        await api('POST', '/api/memory/start', this.pool.size(m.serviceId));
      } catch (err) {
        this.toast({ title: 'Could not start Supermemory', text: err.message, accent: ERROR_ACCENT });
      }
    });
    const keyInput = el('input', { type: 'password', placeholder: 'sm_… (kept in memory only)', autocomplete: 'off' });
    const keyBtn = el('button', { class: 'btn btn-sm' }, 'Connect');
    keyBtn.addEventListener('click', async () => {
      try {
        await api('POST', '/api/memory/key', { key: keyInput.value });
        keyInput.value = '';
      } catch (err) {
        this.toast({ title: 'Key not accepted', text: err.message, accent: ERROR_ACCENT });
      }
    });
    const llm = this.app.settings.memoryLlm || {};
    // Keep what the manager typed/picked across the panel's periodic re-renders.
    this.llmDraft = this.llmDraft || { baseUrl: llm.baseUrl || '', model: llm.model || '', models: [] };
    const draft = this.llmDraft;
    const urlInput = el('input', { value: draft.baseUrl, placeholder: 'e.g. http://localhost:1234/v1', spellcheck: 'false', 'aria-label': 'Model server URL' });
    urlInput.addEventListener('input', () => { draft.baseUrl = urlInput.value.trim(); });
    const modelSelect = el('select', { 'aria-label': 'Model' });
    const fillModels = () => {
      const options = draft.models.length ? draft.models : draft.model ? [draft.model] : [];
      const items = options.length
        ? options.map((id) => el('option', { value: id, selected: id === draft.model }, id))
        : [el('option', { value: '' }, 'Pick a server, then Load models')];
      modelSelect.replaceChildren(...items);
      if (!draft.model && options.length) draft.model = options[0];
    };
    modelSelect.addEventListener('change', () => { draft.model = modelSelect.value; });
    const loadModels = async () => {
      if (!draft.baseUrl) {
        this.toast({ title: 'Enter a server URL first', text: 'Or click LM Studio / Ollama to fill it in.' });
        return;
      }
      try {
        const { models } = await api('GET', `/api/memory/llm/models?baseUrl=${encodeURIComponent(draft.baseUrl)}`);
        draft.models = models.filter((id) => !/embed/i.test(id));
        if (!draft.models.includes(draft.model)) draft.model = draft.models[0] || '';
        fillModels();
        if (!draft.models.length) this.toast({ title: 'No chat models found', text: 'Load a chat model in LM Studio first.' });
      } catch (err) {
        this.toast({ title: 'Could not list models', text: err.message, accent: ERROR_ACCENT });
      }
    };
    fillModels();
    const loadBtn = el('button', { class: 'btn btn-sm', onclick: loadModels }, 'Load models');
    const quick = (label, url) => el('button', {
      class: 'btn btn-sm',
      onclick: () => {
        draft.baseUrl = url;
        urlInput.value = url;
        loadModels();
      },
    }, label);
    const saveBtn = el('button', { class: 'btn btn-sm btn-gold' }, 'Save');
    saveBtn.addEventListener('click', async () => {
      try {
        await api('PATCH', '/api/memory/llm', { baseUrl: draft.baseUrl, model: draft.model });
        this.toast({ title: '🧠 Model saved', text: m.managed ? 'Restart the memory server to use it.' : 'It will be used when the memory server starts.' });
      } catch (err) {
        this.toast({ title: 'Not saved', text: err.message, accent: ERROR_ACCENT });
      }
    });
    const restartBtn = m.managed ? el('button', { class: 'btn btn-sm' }, '⟳ Restart server') : null;
    restartBtn?.addEventListener('click', async () => {
      await api('POST', '/api/memory/stop');
      setTimeout(() => api('POST', '/api/memory/start', this.pool.size(m.serviceId)).catch((err) => {
        this.toast({ title: 'Could not restart Supermemory', text: err.message, accent: ERROR_ACCENT });
      }), 800);
    });
    const llmSection = el('div', { class: 'llm' },
      el('h3', { style: 'margin-top:12px' }, '🤖 Model provider'),
      el('p', {}, 'Use a local OpenAI-compatible server (LM Studio, Ollama…) instead of a cloud model. Leave empty to use what you picked at first boot.'),
      el('div', { class: 'row' }, quick('LM Studio', 'http://localhost:1234/v1'), quick('Ollama', 'http://localhost:11434/v1')),
      el('div', { class: 'row', style: 'margin-top:6px' }, urlInput, loadBtn),
      el('div', { class: 'row', style: 'margin-top:6px' }, modelSelect, saveBtn, restartBtn));
    const keyNote = { captured: 'key picked up from first boot', env: 'key from SUPERMEMORY_API_KEY', manager: 'key you pasted' }[m.keySource] || '';
    this.showPanel(el('div', {},
      el('ol', { class: 'steps' },
        step(m.installed, 1, 'Install Supermemory Local', installBtn),
        step(m.running, 2, m.managed ? 'Memory server running here in the office' : 'Run the memory server (first boot sets up local embeddings and prints an API key)', startBtn),
        step(m.connected, 3, m.connected ? `Connected (${keyNote})` : 'Connect with the API key from first boot',
          el('div', { class: 'row', style: 'flex:1;min-width:220px' }, keyInput, keyBtn))),
      el('p', {}, 'First boot may ask which model provider to use — answer in the terminal below; it goes straight to Supermemory. ',
        'Plexi never writes the Supermemory key to disk. Set ', el('code', {}, 'SUPERMEMORY_API_KEY'), ' before ', el('code', {}, 'npm start'), ' to keep it across restarts.'),
      m.lastError ? el('p', { style: 'color:#b42318' }, m.lastError) : null,
      el('p', {}, m.autoMemory ? "✨ Each finished agent turn is saved to that agent's memory automatically." : 'Auto-save is off (PLEXI_AUTO_MEMORY=0).'),
      llmSection));
  }

  // ── group chat ──────────────────────────────────────────────────────────
  async openChat() {
    this.addTab(CHAT_TAB);
    this.active = CHAT_TAB;
    this.panelMode = null;
    this.show();
    this.renderTabs();
    this.pool.hideAll();
    this.headEl.style.setProperty('--accent', '#60A5FA');
    this.headEl.replaceChildren(el('div', { class: 'meta' },
      el('div', { class: 'title' }, el('h2', {}, '💬 Group chat')),
      el('div', { class: 'persona' }, 'One channel for the whole office. Agents read it while they work; @Name reaches them right away.')));
    try {
      await this.chat.load();
    } catch (err) {
      this.showPanel(el('p', {}, `Couldn't load the chat: ${err.message}`), { full: true });
      return;
    }
    this.chat.markRead();
    this.showPanel(this.chat.view(), { full: true });
    this.chat.inputEl?.focus();
  }

  onChatMessage(message) {
    const fromOthers = this.chat.add(message);
    const watching = this.isOpen && this.active === CHAT_TAB;
    if (watching) {
      const typing = document.activeElement === this.chat.inputEl;
      this.showPanel(this.chat.view(), { full: true });
      if (typing) this.chat.inputEl?.focus();
    } else if (fromOthers) {
      this.chat.bump();
    }
  }

  // ── office feed ─────────────────────────────────────────────────────────
  async openFeed() {
    this.addTab(FEED_TAB);
    this.active = FEED_TAB;
    this.panelMode = null;
    this.show();
    this.renderTabs();
    this.pool.hideAll();
    this.headEl.style.setProperty('--accent', '#F472B6');
    this.headEl.replaceChildren(el('div', { class: 'meta' },
      el('div', { class: 'title' }, el('h2', {}, '📰 Office feed')),
      el('div', { class: 'persona' }, 'Break-room conversations and relationship news, newest first.')));
    if (!this.feedEntries) {
      this.showPanel(el('p', {}, 'Catching up on the gossip…'), { full: true });
      try {
        this.feedEntries = (await api('GET', '/api/feed')).entries;
      } catch (err) {
        this.showPanel(el('p', {}, `Couldn't load the feed: ${err.message}`), { full: true });
        return;
      }
    }
    this.renderFeed();
  }

  onFeedEntry(entry) {
    if (!this.feedEntries) return;
    this.feedEntries = [entry, ...this.feedEntries].slice(0, 300);
    if (this.active === FEED_TAB) this.renderFeed();
  }

  feedName(id) {
    const agent = this.app.agents.get(id);
    if (!agent) return el('b', {}, 'someone who left');
    return el('button', { class: 'linkish', onclick: () => this.openAgent(id), title: `Open ${agent.name}` }, agent.name);
  }

  feedItem(entry) {
    const A = this.app.agents.get(entry.a);
    const B = this.app.agents.get(entry.b);
    const faces = el('span', { class: 'feed-faces' }, A ? portrait(A, 26) : null, B ? portrait(B, 26) : null);
    if (entry.type === 'report') {
      return el('li', { class: 'feed-report' }, faces, el('div', {},
        el('div', {}, '📝 ', this.feedName(entry.a), entry.auto ? ' finished a stretch of work' : ' reported to Juniper',
          entry.auto ? el('span', { class: 'muted' }, ' (filed by the office)') : null),
        el('div', { class: 'report-text' }, String(entry.text || '').replace(/^\(auto\)\s*/, '')),
        el('small', {}, ago(entry.at))));
    }
    if (entry.type === 'hr') {
      const text = entry.level === 'lifted'
        ? [this.feedName(entry.a), `'s record was cleared by ${entry.by}`]
        : [entry.by, entry.level === 'suspension' ? ' suspended ' : ' warned ', this.feedName(entry.a),
          entry.level === 'suspension' ? ` until ${new Date(entry.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''];
      return el('li', { class: `feed-hr feed-hr-${entry.level}` }, faces, el('div', {},
        el('div', {}, `${SANCTION_ICONS[entry.level] || '📋'} `, ...text),
        entry.reason ? el('div', { class: 'muted' }, entry.reason) : null,
        el('small', {}, ago(entry.at))));
    }
    if (entry.type === 'gossip') {
      return el('li', { class: 'feed-gossip' }, faces, el('div', {},
        el('div', {}, `${entry.label?.emoji || '💞'} `, this.feedName(entry.a), ' & ', this.feedName(entry.b),
          ` are now `, el('b', {}, entry.label?.label || 'something new'),
          entry.prevLabel ? el('span', { class: 'muted' }, ` (was ${entry.prevLabel.emoji} ${entry.prevLabel.label})`) : null),
        el('small', {}, ago(entry.at))));
    }
    const speakers = [entry.a, entry.b];
    return el('li', { class: 'feed-chat' }, faces, el('div', {},
      el('div', {}, this.feedName(entry.a), ' & ', this.feedName(entry.b), el('small', {}, ` · ${ROOM_LABELS[entry.room] || ''} · ${ago(entry.at)}`)),
      el('ul', { class: 'transcript' }, (entry.lines || []).map((l) => el('li', {},
        el('b', {}, `${this.app.agents.get(speakers[l.who])?.name || '?'}: `), l.text)))));
  }

  renderFeed() {
    const entries = (this.feedEntries || []).filter((e) => this.feedFilter === 'all' || e.type === this.feedFilter);
    const filters = el('div', { class: 'row feed-filters' }, FEED_FILTERS.map(([key, label]) => el('button', {
      class: `btn btn-sm${this.feedFilter === key ? ' btn-pink' : ''}`,
      onclick: () => {
        this.feedFilter = key;
        this.renderFeed();
      },
    }, label)));
    const body = entries.length
      ? el('ul', { class: 'feed' }, entries.map((e) => this.feedItem(e)))
      : el('p', {}, "Nothing yet — conversations show up here once agents chat on their breaks.");
    this.showPanel(el('div', {}, filters, body), { full: true });
  }

  // ── keeping the open view fresh ─────────────────────────────────────────
  refresh() {
    if (!this.isOpen) return;
    this.renderTabs();
    if (this.active === MEMORY_TAB) {
      if (!this.panelEl.contains(document.activeElement)) this.openMemory();
      return;
    }
    if (this.active === FEED_TAB || this.active === CHAT_TAB) return;
    const agent = this.app.agents.get(this.active);
    if (!agent) {
      this.closeTab(this.active);
      return;
    }
    this.renderAgentHead(agent);
    if (this.panelMode === 'relationships') this.renderRelationships(agent);
  }
}
