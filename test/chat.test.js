import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatStore, MANAGER_ID } from '../server/chat.js';

const agents = [{ id: 'a_m', name: 'Mochi' }, { id: 'a_k', name: 'Kiwi' }, { id: 'a_j', name: 'Juniper' }];

function fresh() {
  const clock = { t: 1_000_000 };
  const chat = new ChatStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'plexi-chat-')), 'chat.json'), { now: () => clock.t });
  return { chat, clock };
}

test('messages record @mentions by name, and @all for everyone', () => {
  const { chat } = fresh();
  const m = chat.post({ from: 'a_m', name: 'Mochi', text: '  @kiwi can you check PR #3? cc @Juniper. @nobody  ', agents });
  assert.equal(m.text, '@kiwi can you check PR #3? cc @Juniper. @nobody');
  assert.deepEqual(m.mentions.sort(), ['a_j', 'a_k']);
  const all = chat.post({ from: MANAGER_ID, name: 'riri', text: 'Standup in 5, @all', agents });
  assert.deepEqual(all.mentions, ['all']);
});

test('agents are rate limited and messages are length-checked; the manager is never throttled', () => {
  const { chat, clock } = fresh();
  chat.post({ from: 'a_m', name: 'Mochi', text: 'one', agents });
  assert.throws(() => chat.post({ from: 'a_m', name: 'Mochi', text: 'two', agents }), /Slow down/);
  clock.t += 9000;
  chat.post({ from: 'a_m', name: 'Mochi', text: 'two', agents });
  assert.throws(() => chat.post({ from: 'a_k', name: 'Kiwi', text: '   ', agents }), /empty/);
  assert.throws(() => chat.post({ from: 'a_k', name: 'Kiwi', text: 'x'.repeat(501), agents }), /under 500/);
  chat.post({ from: MANAGER_ID, name: 'riri', text: 'a', agents });
  chat.post({ from: MANAGER_ID, name: 'riri', text: 'b', agents });
});

test('reading shows what they missed; mid-work nudges only carry mentions and manager messages, once', () => {
  const { chat, clock } = fresh();
  chat.post({ from: 'a_m', name: 'Mochi', text: 'general chatter', agents });
  clock.t += 10_000;
  chat.post({ from: 'a_j', name: 'Juniper', text: '@Kiwi please rebase on main', agents });
  clock.t += 10_000;
  chat.post({ from: MANAGER_ID, name: 'riri', text: 'nice work today', agents });
  clock.t += 1;
  const nudge = chat.nudgesFor('a_k');
  assert.deepEqual(nudge.messages.map((m) => m.text), ['@Kiwi please rebase on main', 'nice work today']);
  assert.equal(nudge.unread, 3);
  assert.equal(chat.nudgesFor('a_k').messages.length, 0, 'delivered once');
  assert.equal(chat.nudgesFor('a_m').messages.length, 1, "Mochi only gets the manager's message");
  const read = chat.readFor('a_k');
  assert.equal(read.unread, 3);
  assert.equal(chat.readFor('a_k').unread, 0);
  assert.equal(chat.unreadCount('a_m'), 2, 'their own posts never count');
});

test('the chat survives a restart', () => {
  const { chat } = fresh();
  chat.post({ from: 'a_m', name: 'Mochi', text: 'persist me', agents });
  chat.flush();
  const again = new ChatStore(chat.file).load();
  assert.equal(again.recent(5)[0].text, 'persist me');
});
