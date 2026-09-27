#!/usr/bin/env node
/**
 * Tiny reporter run by agent CLIs (Claude Code hooks, Codex `notify`).
 * Posts the event to the Plexi Office server. Must never block or break the
 * agent: no stdout (Claude adds UserPromptSubmit stdout to context), short
 * timeouts, always exit 0.
 *
 *   notify.js <kind>            payload JSON on stdin   (Claude Code hooks)
 *   notify.js <kind> <json>     payload JSON as argv    (Codex notify)
 */
const MAX_FIELD = 6000;
const { PLEXI_URL, PLEXI_AGENT_ID, PLEXI_TOKEN } = process.env;
const [, , kind, argPayload] = process.argv;

function readStdin(timeoutMs) {
  return new Promise((resolve) => {
    let data = '';
    const done = () => resolve(data);
    const timer = setTimeout(done, timeoutMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => { clearTimeout(timer); done(); });
    process.stdin.on('error', () => { clearTimeout(timer); done(); });
  });
}

function trimPayload(raw) {
  let payload;
  try {
    payload = JSON.parse(raw || '{}');
  } catch {
    return { raw: String(raw).slice(0, MAX_FIELD) };
  }
  for (const key of ['tool_response', 'tool_input', 'input-messages']) {
    if (payload[key] === undefined) continue;
    const text = typeof payload[key] === 'string' ? payload[key] : JSON.stringify(payload[key]);
    if (text.length > MAX_FIELD) payload[key] = text.slice(-MAX_FIELD);
  }
  return payload;
}

async function main() {
  if (!PLEXI_URL || !PLEXI_AGENT_ID || !PLEXI_TOKEN || !/^[a-z-]+$/.test(kind || '')) return;
  // Only read stdin for hooks; Codex's notify may share the agent's TTY.
  const raw = argPayload ?? (process.stdin.isTTY ? '{}' : await readStdin(800));
  await fetch(`${PLEXI_URL}/api/hook/${encodeURIComponent(PLEXI_AGENT_ID)}/${kind}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-plexi-token': PLEXI_TOKEN },
    body: JSON.stringify(trimPayload(raw)),
    signal: AbortSignal.timeout(1500),
  });
}

main().catch(() => {}).finally(() => process.exit(0));
