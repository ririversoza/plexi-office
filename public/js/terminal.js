// One xterm.js instance per session (agent, installer, memory server), kept
// alive while the drawer is closed so scrollback survives tab switches.
import { Terminal } from '/vendor/xterm/lib/xterm.mjs';
import { FitAddon } from '/vendor/xterm-fit/lib/addon-fit.mjs';

const THEME = {
  background: '#1e1f2e',
  foreground: '#e7e5f2',
  cursor: '#f2b84b',
  selectionBackground: '#4b4a6b',
  black: '#2a2b3d', red: '#ff7a8a', green: '#7ee0a1', yellow: '#ffd479',
  blue: '#8ab4ff', magenta: '#d7a6ff', cyan: '#7fdbe0', white: '#e7e5f2',
  brightBlack: '#6b6a85', brightRed: '#ff9aa6', brightGreen: '#a3f0bf', brightYellow: '#ffe29e',
  brightBlue: '#abc8ff', brightMagenta: '#e5c2ff', brightCyan: '#a6ecef', brightWhite: '#ffffff',
};

export class TerminalPool {
  constructor(socket, host) {
    this.socket = socket;
    this.host = host;
    this.sessions = new Map();
    this.activeId = null;
    new ResizeObserver(() => this.fitActive()).observe(host);
    socket.on('out', ({ id, data }) => this.sessions.get(id)?.term.write(data));
    socket.on('replay', ({ id, data }) => {
      const s = this.sessions.get(id);
      if (!s) return;
      s.term.reset();
      if (data) s.term.write(data);
    });
    // After a reconnect, re-attach everything to get a fresh replay.
    socket.on('open', () => {
      for (const id of this.sessions.keys()) socket.send({ t: 'attach', id });
    });
  }

  ensure(id) {
    const existing = this.sessions.get(id);
    if (existing) return existing;
    const el = document.createElement('div');
    el.className = 'term';
    el.hidden = true;
    this.host.appendChild(el);
    const term = new Terminal({
      theme: THEME,
      fontFamily: '"SF Mono", Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.15,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
      macOptionIsMeta: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    term.onData((data) => this.socket.send({ t: 'input', id, data }));
    const session = { id, el, term, fit };
    this.sessions.set(id, session);
    this.socket.send({ t: 'attach', id });
    return session;
  }

  show(id) {
    const s = this.ensure(id);
    for (const other of this.sessions.values()) other.el.hidden = other !== s;
    this.activeId = id;
    requestAnimationFrame(() => {
      this.fitActive();
      s.term.focus();
    });
    return s;
  }

  hideAll() {
    for (const s of this.sessions.values()) s.el.hidden = true;
    this.activeId = null;
  }

  /** Measures the drawer so a freshly launched CLI starts at the right size. */
  size(id = this.activeId) {
    const s = this.sessions.get(id);
    if (!s) return { cols: 110, rows: 32 };
    try {
      const dims = s.fit.proposeDimensions();
      if (dims?.cols && dims?.rows) return { cols: dims.cols, rows: dims.rows };
    } catch {
      // not laid out yet
    }
    return { cols: s.term.cols, rows: s.term.rows };
  }

  fitActive() {
    const s = this.sessions.get(this.activeId);
    if (!s || s.el.hidden || !s.el.clientWidth) return;
    try {
      s.fit.fit();
    } catch {
      return;
    }
    this.socket.send({ t: 'resize', id: s.id, cols: s.term.cols, rows: s.term.rows });
  }

  focus() {
    this.sessions.get(this.activeId)?.term.focus();
  }

  dispose(id) {
    const s = this.sessions.get(id);
    if (!s) return;
    this.socket.send({ t: 'detach', id });
    s.term.dispose();
    s.el.remove();
    this.sessions.delete(id);
    if (this.activeId === id) this.activeId = null;
  }
}
