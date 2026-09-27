import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KeyRedactor, agentTag } from '../server/memory.js';

const FAKE_KEY = `sm_${'x'.repeat(28)}`; // synthetic, not a real key

function run(chunks) {
  const seen = [];
  let out = '';
  const redactor = new KeyRedactor((key) => seen.push(key), { holdMs: 5 });
  for (const c of chunks) redactor.push(c, (d) => { out += d; });
  return new Promise((resolve) => setTimeout(() => resolve({ out, seen }), 30));
}

test('the first-boot key is captured and never passed through', async () => {
  const { out, seen } = await run([`Your API key: ${FAKE_KEY}\r\nListening on :6767\r\n`]);
  assert.deepEqual(seen, [FAKE_KEY]);
  assert.ok(!out.includes(FAKE_KEY));
  assert.match(out, /sm_•+/);
  assert.match(out, /Listening on :6767/);
});

test('a key split across chunks is still redacted', async () => {
  const { out, seen } = await run(['API key: s', 'm_', `${'x'.repeat(28)}\r\n`]);
  assert.deepEqual(seen, [FAKE_KEY]);
  assert.ok(!out.includes('x'.repeat(28)));
});

test('ordinary output flows through unchanged', async () => {
  const { out, seen } = await run(['Loading embeddings…\r\n', 'ready: files\r\n']);
  assert.equal(out, 'Loading embeddings…\r\nready: files\r\n');
  assert.deepEqual(seen, []);
});

test('agent tags only use allowed characters', () => {
  assert.match(agentTag('a_12ab'), /^[A-Za-z0-9_:-]+$/);
});
