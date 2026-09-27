// REST + websocket plumbing to the office server.
const RECONNECT_MS = 1500;

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, res.status, data);
  return data;
}

/** Auto-reconnecting socket. `on(type, fn)` subscribes to server message types. */
export class Socket {
  constructor() {
    this.handlers = new Map();
    this.queue = [];
    this.connect();
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.onopen = () => {
      for (const msg of this.queue.splice(0)) this.ws.send(msg);
      this.emit('open', {});
    };
    this.ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      this.emit(msg.t, msg);
    };
    this.ws.onclose = () => {
      this.emit('close', {});
      setTimeout(() => this.connect(), RECONNECT_MS);
    };
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
  }

  emit(type, msg) {
    for (const fn of this.handlers.get(type) || []) {
      try {
        fn(msg);
      } catch (err) {
        console.error(`[socket] handler for ${type} failed`, err);
      }
    }
  }

  send(msg) {
    const raw = JSON.stringify(msg);
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(raw);
    else if (msg.t !== 'input') this.queue.push(raw);
  }
}
