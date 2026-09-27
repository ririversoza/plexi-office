import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCanon, templateCanon, canonBrief } from '../server/canon.js';
import { parseModelJson, validateDialogue } from '../server/writer.js';

const agent = { id: 'a_1', name: 'Mochi', type: 'claude', role: 'worker', personality: 'sleuth', look: { seed: 42 } };

test('every agent gets a stable starter canon that fits their personality', () => {
  const a = templateCanon(agent);
  assert.deepEqual(a, templateCanon(agent), 'deterministic');
  assert.equal(a.pronouns, 'they/them');
  for (const key of ['hometown', 'backstory', 'speechStyle', 'quirk', 'secret', 'goal']) assert.ok(a[key], key);
  assert.ok(a.hobbies.length >= 2);
  assert.match(canonBrief({ ...agent, canon: a }), /Mochi/);
});

test('canon edits are clipped and validated', () => {
  const c = sanitizeCanon({ pronouns: 'she/her', backstory: 'x'.repeat(900), hobbies: ['a', 'b', 'c', 'd', 'e', 'f'], evil: 1 });
  assert.equal(c.pronouns, 'she/her');
  assert.equal(c.backstory.length, 400);
  assert.equal(c.hobbies.length, 4);
  assert.ok(!('evil' in c));
  assert.throws(() => sanitizeCanon({ hobbies: 'not a list' }), /hobbies/);
});

test('model JSON is parsed even with thinking tags or prose around it', () => {
  assert.deepEqual(parseModelJson('<think>hmm</think>\n{"lines":[]}'), { lines: [] });
  assert.deepEqual(parseModelJson('Sure! ```json\n{"a":1}\n``` hope that helps'), { a: 1 });
  assert.throws(() => parseModelJson('no json here'));
});

test('dialogue from the model is validated: speakers, faces, poses, length', () => {
  const lines = validateDialogue({
    lines: [
      { who: 0, text: 'Hey Kiwi!', face: 'grin', pose: 'wave' },
      { who: 1, text: 'x'.repeat(300), face: 'not-a-face', pose: 'moonwalk' },
      { who: 5, text: 'wrong speaker' },
      { who: 0, text: '   ' },
      { who: 0, text: 'Up top!', together: 'highfive' },
    ],
  });
  assert.equal(lines.length, 3);
  assert.equal(lines[1].text.length, 110);
  assert.equal(lines[1].face, 'happy');
  assert.equal(lines[1].pose, 'chat');
  assert.equal(lines[2].together, 'highfive');
  assert.throws(() => validateDialogue({ lines: [{ who: 0, text: 'only one' }] }), /short/);
});

test('a speaker name the model puts at the start of a line is removed', () => {
  const lines = validateDialogue({ lines: [{ who: 0, text: 'Mochi: Oh no!' }, { who: 1, text: 'kiwi : We got this' }] }, ['Mochi', 'Kiwi']);
  assert.deepEqual(lines.map((l) => l.text), ['Oh no!', 'We got this']);
});

test('words stuck on repeat are collapsed', () => {
  assert.equal(sanitizeCanon({ quirk: 'Drops names like heirloom heirloom heirloom heirloom' }).quirk, 'Drops names like heirloom');
});
