import { EventEmitter } from 'node:events';
import pty from 'node-pty';
import headless from '@xterm/headless';
import { SCROLLBACK_BYTES } from './config.js';
import { StatusTracker } from './status.js';

const DEFAULT_COLS = 110;
const DEFAULT_ROWS = 32;
const { Terminal: HeadlessTerminal } = headless;

function clampSize(value, fallback, min, max) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : fallback;
}

/**
 * Owns every pty: one per agent (id = agent id) plus installer runs
 * (id = "install:<type>"). Emits 'data' (id, chunk), 'exit' (id, code).
 */
export class SessionManager extends EventEmitter {
  constructor() {
    super();
    this.sessions = new Map();
  }

  get(id) {
    return this.sessions.get(id) || null;
  }

  isRunning(id) {
    const s = this.sessions.get(id);
    return Boolean(s && !s.exited);
  }

  /** `filter(data, deliver)` may transform or delay output (e.g. redact secrets) before anyone sees it. */
  spawn(id, { file, args, cwd, env, cols, rows, kind = 'agent', filter, textConflicts = true }) {
    if (this.isRunning(id)) return this.sessions.get(id);

    const size = { cols: clampSize(cols, DEFAULT_COLS, 20, 400), rows: clampSize(rows, DEFAULT_ROWS, 5, 200) };
    const proc = pty.spawn(file, args, { name: 'xterm-256color', ...size, cwd, env });
    const session = {
      id,
      kind,
      proc,
      chunks: [],
      bytes: 0,
      tracker: new StatusTracker({ textConflicts }),
      // Virtual screen so other agents (the Assistant Manager) can read what is on it.
      screen: new HeadlessTerminal({ ...size, scrollback: 1000, allowProposedApi: true }),
      exited: false,
      exitCode: null,
      startedAt: Date.now(),
    };
    session.tracker.start();
    this.sessions.set(id, session);

    const deliver = (data) => {
      this.append(session, data);
      session.screen.write(data);
      session.tracker.output(data);
      this.emit('data', id, data);
    };
    proc.onData((data) => (filter ? filter(data, deliver) : deliver(data)));
    proc.onExit(({ exitCode }) => {
      session.exited = true;
      session.exitCode = exitCode;
      session.tracker.exit();
      const note = `\r\n\x1b[2m[process exited with code ${exitCode}]\x1b[0m\r\n`;
      this.append(session, note);
      this.emit('data', id, note);
      this.emit('exit', id, exitCode);
    });
    return session;
  }

  append(session, data) {
    session.chunks.push(data);
    session.bytes += data.length;
    while (session.bytes > SCROLLBACK_BYTES && session.chunks.length > 1) {
      session.bytes -= session.chunks.shift().length;
    }
  }

  replay(id) {
    return this.sessions.get(id)?.chunks.join('') ?? '';
  }

  /** Last `lines` non-blank lines of what the session's screen shows. */
  screenText(id, lines = 20) {
    const s = this.sessions.get(id);
    if (!s) return '';
    const buf = s.screen.buffer.active;
    const out = [];
    for (let i = buf.length - 1; i >= 0 && out.length < lines; i--) {
      const text = buf.getLine(i)?.translateToString(true) ?? '';
      if (text.trim() || out.length) out.push(text.replace(/\s+$/, ''));
    }
    while (out.length && !out[out.length - 1].trim()) out.pop();
    return out.reverse().join('\n');
  }

  /** Text of the rows currently visible on the session's screen. */
  visibleText(id) {
    const s = this.sessions.get(id);
    if (!s) return '';
    const buf = s.screen.buffer.active;
    const rows = [];
    for (let i = buf.viewportY; i < buf.viewportY + s.screen.rows; i++) {
      rows.push(buf.getLine(i)?.translateToString(true) ?? '');
    }
    return rows.join('\n');
  }

  write(id, data) {
    const s = this.sessions.get(id);
    if (!s || s.exited) return false;
    s.proc.write(data);
    s.tracker.input(data);
    return true;
  }

  resize(id, cols, rows) {
    const s = this.sessions.get(id);
    if (!s || s.exited) return;
    try {
      const c = clampSize(cols, DEFAULT_COLS, 20, 400);
      const r = clampSize(rows, DEFAULT_ROWS, 5, 200);
      s.proc.resize(c, r);
      s.screen.resize(c, r);
    } catch {
      // pty may have just exited
    }
  }

  kill(id) {
    const s = this.sessions.get(id);
    if (s && !s.exited) {
      try {
        s.proc.kill();
      } catch {
        // already gone
      }
    }
  }

  forget(id) {
    this.kill(id);
    this.sessions.get(id)?.screen.dispose();
    this.sessions.delete(id);
  }

  killAll() {
    for (const id of this.sessions.keys()) this.kill(id);
  }

  running(kind = 'agent') {
    return [...this.sessions.values()].filter((s) => s.kind === kind && !s.exited);
  }
}
