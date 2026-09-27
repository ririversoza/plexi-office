import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SanctionStore } from '../server/sanctions.js';
import { buildPersonaPrompt } from '../server/personality.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plexi-hr-'));
const kiwi = { id: 'a_k', name: 'Kiwi', role: 'worker', type: 'codex', personality: 'guardian', cwd: '/ws' };
const juniper = { id: 'a_j', name: 'Juniper', role: 'assistant', type: 'claude', personality: 'organizer' };
const MIN = 60_000;

function storeAt(clock) {
  return new SanctionStore(path.join(tmp, `${Math.random()}.json`), { now: () => clock.t }).load();
}

test('HR warns first; a suspension needs an active warning and clocks the agent out for a while', () => {
  const clock = { t: 1_000_000 };
  const s = storeAt(clock);
  assert.throws(() => s.issue({ agent: kiwi, level: 'suspension', reason: 'copied bao/roster.js into kiwi/', by: 'Poppy' }), /no active warning/);
  const warning = s.issue({ agent: kiwi, level: 'warning', reason: 'copied bao/roster.js into kiwi/ (PR #5)', by: 'Poppy' });
  assert.equal(s.current(kiwi.id).level, 'warning');
  assert.throws(() => s.issue({ agent: kiwi, level: 'suspension', reason: 'did it again in PR #6', by: 'Poppy', minutes: 30 }), /just sanctioned/);
  clock.t += 6 * MIN;
  assert.throws(() => s.issue({ agent: kiwi, level: 'suspension', reason: 'did it again in PR #6', by: 'Poppy', minutes: 999 }), /5–240 minutes/);
  const suspension = s.issue({ agent: kiwi, level: 'suspension', reason: 'did it again in PR #6', by: 'Poppy', minutes: 30 });
  assert.equal(s.current(kiwi.id).id, suspension.id, 'a suspension outranks the warning');
  assert.ok(s.suspension(kiwi.id));
  clock.t += 31 * MIN;
  assert.equal(s.suspension(kiwi.id), null, 'suspensions run out');
  assert.equal(s.current(kiwi.id).id, warning.id, 'the warning is still on record');
  assert.equal(s.history(kiwi.id).length, 2);
});

test('staff, vague reasons and unknown levels are refused; lifting clears the record and persists', () => {
  const clock = { t: 5_000_000 };
  const s = storeAt(clock);
  assert.throws(() => s.issue({ agent: juniper, level: 'warning', reason: 'being too organised', by: 'Poppy' }), /staff answer to the manager/);
  assert.throws(() => s.issue({ agent: kiwi, level: 'warning', reason: 'bad', by: 'Poppy' }), /concrete reason/);
  assert.throws(() => s.issue({ agent: kiwi, level: 'fired', reason: 'copied someone else', by: 'Poppy' }), /Level must be/);
  s.issue({ agent: kiwi, level: 'warning', reason: 'read taro/ worktree without being asked', by: 'Poppy' });
  assert.equal(s.lift({ agentId: kiwi.id, by: 'magic-riri' }).length, 1);
  assert.equal(s.current(kiwi.id), null);
  const reloaded = new SanctionStore(s.file, { now: () => clock.t }).load();
  assert.equal(reloaded.history(kiwi.id)[0].liftedBy, 'magic-riri');
  assert.equal(s.lift({ agentId: kiwi.id, by: 'magic-riri' }).length, 0, 'nothing left to lift');
});

test('agents hear about their record and the conduct rules at launch', () => {
  const plain = buildPersonaPrompt(kiwi, { defaultCwd: '/ws' });
  assert.match(plain, /don't copy another agent's code/);
  assert.doesNotMatch(plain, /HR record/);
  const warned = buildPersonaPrompt(kiwi, { defaultCwd: '/ws', sanction: { level: 'warning', by: 'Poppy', reason: 'copied bao/', until: Date.now() + MIN } });
  assert.match(warned, /HR record: you are on a warning from Poppy/);
  const hr = buildPersonaPrompt({ ...kiwi, role: 'hr', name: 'Poppy' }, { defaultCwd: '/ws' });
  assert.match(hr, /plexi sanction warn/);
});
