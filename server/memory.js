import net from 'node:net';

/**
 * Talks to a local Supermemory server (https://github.com/supermemoryai/supermemory,
 * "Supermemory Local"). Each agent gets its own container tag; `plexi-office`
 * holds notes shared by everyone.
 *
 * The API key is printed by `supermemory-server` on first boot. We read it from
 * SUPERMEMORY_API_KEY, from the managed server's own output, or from the
 * manager pasting it in the UI — and keep it in memory only (never persisted,
 * never sent to the browser or logged).
 */
export const OFFICE_TAG = 'plexi-office';
const REQUEST_TIMEOUT_MS = 8000;
const VERIFY_EVERY_MS = 5 * 60_000; // authenticated check; each one costs an embedding

const KEY_GLOBAL_RE = /\bsm_[A-Za-z0-9_-]{16,}/g;
const PARTIAL_KEY_AT_END_RE = /s(?:m(?:_[A-Za-z0-9_-]*)?)?$/;
const REDACTED = 'sm_••••••••';

/**
 * Streams the memory server's terminal output with its API key blanked out,
 * handing any key it sees to `onKey`. Holds back a possible partial key at the
 * end of a chunk (briefly) so a key split across writes is still caught.
 */
export class KeyRedactor {
  constructor(onKey, { holdMs = 250 } = {}) {
    this.onKey = onKey;
    this.holdMs = holdMs;
    this.pending = '';
    this.timer = null;
  }

  clean(text) {
    for (const match of text.matchAll(KEY_GLOBAL_RE)) this.onKey(match[0]);
    return text.replace(KEY_GLOBAL_RE, REDACTED);
  }

  push(data, emit) {
    clearTimeout(this.timer);
    let text = this.pending + data;
    this.pending = '';
    const tail = PARTIAL_KEY_AT_END_RE.exec(text);
    if (tail) {
      this.pending = text.slice(tail.index);
      text = text.slice(0, tail.index);
      this.timer = setTimeout(() => {
        const rest = this.pending;
        this.pending = '';
        if (rest) emit(this.clean(rest));
      }, this.holdMs);
      this.timer.unref?.();
    }
    if (text) emit(this.clean(text));
  }
}

export function agentTag(agentId) {
  return `plexi-agent-${agentId}`.replace(/[^A-Za-z0-9_:-]/g, '-').slice(0, 100);
}

export class MemoryService {
  constructor({ url = process.env.SUPERMEMORY_URL || 'http://localhost:6767' } = {}) {
    this.url = url.replace(/\/+$/, '');
    this.key = process.env.SUPERMEMORY_API_KEY || null;
    this.keySource = this.key ? 'env' : null;
    this.running = false;
    this.connected = false;
    this.lastError = null;
  }

  hasKey() {
    return Boolean(this.key);
  }

  setKey(key, source = 'manager') {
    const trimmed = String(key || '').trim();
    if (!/^sm_[A-Za-z0-9_-]{8,200}$/.test(trimmed)) return false;
    this.key = trimmed;
    this.keySource = source;
    this.connected = false; // a new key gets verified on the next probe
    this.verifiedAt = 0;
    return true;
  }


  portOpen() {
    const { hostname, port } = new URL(this.url);
    return new Promise((resolve) => {
      const socket = net.connect({ host: hostname, port: Number(port) || 80 });
      const finish = (ok) => { socket.destroy(); resolve(ok); };
      socket.setTimeout(800, () => finish(false));
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
    });
  }

  async request(path, body) {
    if (!this.key) throw new Error('Supermemory API key not set');
    const res = await fetch(`${this.url}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Supermemory ${path} → ${res.status} ${text.slice(0, 200)}`);
    }
    return res.json();
  }

  /**
   * Cheap liveness check (a TCP connect) on every poll; the real authenticated
   * search — which costs an embedding — only when something changed or every few minutes.
   */
  async probe() {
    const wasRunning = this.running;
    this.running = await this.portOpen();
    if (!this.running || !this.key) {
      this.connected = false;
      return this.status();
    }
    const stale = Date.now() - (this.verifiedAt || 0) > VERIFY_EVERY_MS;
    if (this.connected && wasRunning && !stale) return this.status();
    try {
      await this.request('/v4/search', { q: 'ping', containerTag: OFFICE_TAG, limit: 1 });
      this.connected = true;
      this.lastError = null;
      this.verifiedAt = Date.now();
    } catch (err) {
      this.connected = false;
      this.lastError = err.message;
    }
    return this.status();
  }

  status() {
    return {
      url: this.url,
      running: this.running,
      connected: this.connected,
      hasKey: this.hasKey(),
      keySource: this.keySource,
      lastError: this.lastError,
    };
  }

  async add(tag, content, metadata = {}) {
    const text = String(content || '').trim().slice(0, 8000);
    if (!text) throw new Error('Nothing to remember');
    return this.request('/v3/documents', { content: text, containerTag: tag, metadata });
  }

  async search(tags, q, { limit = 6, threshold = 0.5 } = {}) {
    const query = String(q || '').trim().slice(0, 1000);
    if (!query) return [];
    const perTag = await Promise.all(
      tags.map((tag) => this.request('/v4/search', { q: query, containerTag: tag, limit, threshold })
        .then((r) => (r.results || []).map((hit) => ({ ...hit, tag })))),
    );
    return perTag
      .flat()
      .map((hit) => ({
        text: hit.memory || hit.chunk || '',
        similarity: hit.similarity ?? 0,
        scope: hit.tag === OFFICE_TAG ? 'office' : 'self',
        updatedAt: hit.updatedAt || null,
      }))
      .filter((hit) => hit.text)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }
}
