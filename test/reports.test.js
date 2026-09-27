import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoReportText } from '../server/reports.js';

const done = 'Finished the CSV export: added mochi/export.js with tests, pushed mochi-export and opened PR #9.';
const base = { role: 'worker', startedAt: 1_000, now: 1_000 + 5 * 60_000, lastReportAt: 0, state: 'working', lastMessage: done };

test('a real stretch of work without a report gets one filed from the last message', () => {
  assert.equal(autoReportText(base), `(auto) ${done}`);
  const long = autoReportText({ ...base, lastMessage: 'x '.repeat(800) });
  assert.ok(long.length <= 607 && long.endsWith('…'));
});

test('no auto report for quick replies, questions, staff, or when they already reported', () => {
  assert.equal(autoReportText({ ...base, now: base.startedAt + 30_000 }), null, 'quick turn');
  assert.equal(autoReportText({ ...base, state: 'question' }), null, 'waiting on the manager');
  assert.equal(autoReportText({ ...base, role: 'assistant' }), null);
  assert.equal(autoReportText({ ...base, role: 'hr' }), null);
  assert.equal(autoReportText({ ...base, lastReportAt: base.startedAt + 1000 }), null, 'reported themselves');
  assert.equal(autoReportText({ ...base, lastMessage: 'Done.' }), null, 'nothing to say');
  assert.equal(autoReportText({ ...base, startedAt: undefined }), null);
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { wakePrompt } from '../server/reports.js';
import { ChatStore } from '../server/chat.js';

test('the wake-up prompt is one line with every report in it', () => {
  const at = Date.now();
  const text = wakePrompt([
    { name: 'Mochi', at, text: 'Finished the CSV export.\nPR #9 is open.' },
    { name: 'Kiwi', at, text: `(auto) ${'y'.repeat(900)}` },
  ]);
  assert.doesNotMatch(text, /\n/, 'a newline would submit early');
  assert.match(text, /^\[Office\] 2 new reports for you\. Mochi \(.+\): Finished the CSV export\. PR #9 is open\. \| Kiwi/);
  assert.match(text, /…/, 'long reports are trimmed');
  assert.match(text, /Don't assign or merge anything the manager hasn't asked for/);
  assert.match(wakePrompt([{ name: 'Sora', at, text: 'done' }]), /^\[Office\] New report for you\./);
});

test('peeking at pending reports does not use them up; delivering does', () => {
  const reports = new ChatStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'plexi-rep-')), 'r.json'), { maxText: 1200, cooldownMs: 0 });
  reports.post({ from: 'a_m', name: 'Mochi', text: 'done with the export', to: ['a_j'] });
  assert.equal(reports.peekNudges('a_j').length, 1);
  assert.equal(reports.peekNudges('a_j').length, 1, 'still pending');
  assert.equal(reports.nudgesFor('a_j').messages.length, 1);
  assert.equal(reports.peekNudges('a_j').length, 0, 'delivered once');
});
