import crypto from 'node:crypto';

/**
 * The office spawns shells, so every entry point is locked to this machine:
 *  - Host header must be our loopback address (blocks DNS rebinding).
 *  - Browser requests that change state must come from our own origin
 *    (blocks other websites driving the API / websocket).
 *  - Calls from agent CLIs (hooks, the `plexi` helper) carry a per-agent token
 *    derived from a per-launch secret, so the server knows who is calling.
 */
export function createGuards({ port, token }) {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  const origins = new Set([...hosts].map((h) => `http://${h}`));
  const agentToken = (agentId) => crypto.createHmac('sha256', token).update(String(agentId)).digest('hex');

  const isAllowedHost = (host) => hosts.has(String(host || '').toLowerCase());
  const isAllowedOrigin = (origin) => origins.has(String(origin || '').toLowerCase());

  const hasValidToken = (agentId, candidate) => {
    const expected = Buffer.from(agentToken(agentId));
    const buf = Buffer.from(String(candidate || ''));
    return buf.length === expected.length && crypto.timingSafeEqual(buf, expected);
  };

  function hostGuard(req, res, next) {
    if (!isAllowedHost(req.headers.host)) return res.status(403).json({ error: 'Forbidden host' });
    next();
  }

  function originGuard(req, res, next) {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    if (!isAllowedOrigin(req.headers.origin)) return res.status(403).json({ error: 'Forbidden origin' });
    next();
  }

  /** For /api/hook/:id/... — token must belong to the agent in the URL. */
  function hookGuard(req, res, next) {
    if (!hasValidToken(req.params.id, req.headers['x-plexi-token'])) return res.status(401).json({ error: 'Bad token' });
    next();
  }

  /** For the `plexi` helper — sets req.agentId from x-plexi-agent. */
  function agentGuard(req, res, next) {
    const agentId = String(req.headers['x-plexi-agent'] || '');
    if (!agentId || !hasValidToken(agentId, req.headers['x-plexi-token'])) {
      return res.status(401).json({ error: 'Unknown agent' });
    }
    req.agentId = agentId;
    next();
  }

  function verifyWebSocket(req) {
    return isAllowedHost(req.headers.host) && isAllowedOrigin(req.headers.origin);
  }

  return { hostGuard, originGuard, hookGuard, agentGuard, verifyWebSocket, agentToken, isAllowedHost, isAllowedOrigin, hasValidToken };
}
