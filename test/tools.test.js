import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createToolsRouter } from '../server/tools.js';
import { createGuards } from '../server/security.js';
import { AgentStore, ValidationError } from '../server/store.js';
import { GitError } from '../server/github.js';
import { SanctionStore } from '../server/sanctions.js';
import { SpriteStore } from '../server/sprites.js';
import { ChatStore } from '../server/chat.js';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plexi-tools-'));
const store = new AgentStore(path.join(tmp, 'agents.json')).load();
const guards = createGuards({ port: 1, token: 'test-secret' });
const hired = [];
const assigned = [];
const sanctioned = [];
const chatted = [];
const sanctions = new SanctionStore(path.join(tmp, 'sanctions.json')).load();
const fakeSessions = { screenText: (id) => `screen of ${id}` };
const fakeMemory = { connected: false };
let server;
let base;

const hr = store.list().find((a) => a.role === 'hr');
const assistant = store.list().find((a) => a.role === 'assistant');
const worker = store.list().find((a) => a.role === 'worker');

function call(agent, method, url, body, token = guards.agentToken(agent.id)) {
  return fetch(`${base}${url}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-plexi-agent': agent.id, 'x-plexi-token': token },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
}

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/tools', createToolsRouter({
    store,
    sessions: fakeSessions,
    statusOf: (id) => ({ state: store.get(id)?.name === 'Bao' ? 'question' : 'working', detail: '', since: Date.now() }),
    memory: fakeMemory,
    guards,
    getClis: async () => ({ claude: { installed: true }, codex: { installed: true }, cursor: { installed: false } }),
    onHire: (agent) => hired.push(agent),
    github: {
      push: async (dir) => ({ branch: `pushed ${dir}` }),
      fetch: async () => ({ ok: true }),
      createPr: async (dir, opts) => ({ branch: 'b', url: 'u', footer: opts.footer }),
      listPrs: async () => [{ number: 1 }],
      mergePr: async (n, { method }) => ({ number: Number(n), method }),
      viewPr: async (n) => { if (n === '404') throw new GitError(502, 'gh pr: not found'); return { number: Number(n) }; },
    },
    sanctions,
    sprites: new SpriteStore(path.join(tmp, 'sprites')),
    chat: new ChatStore(path.join(tmp, 'chat.json')),
    reports: new ChatStore(path.join(tmp, 'reports.json'), { maxText: 1200, cooldownMs: 0 }),
    onReport: () => {},
    onChat: (message, by) => chatted.push({ vibe: message.vibe, by: by.name }),
    relationshipsOf: (agent) => [{ name: 'Sora', label: 'Rivals', emoji: '⚔️', affinity: -42, with: agent.name }],
    onSanction: async (record, agent) => sanctioned.push({ level: record.level, name: agent.name }),
    onLift: () => {},
    onAssign: async (agent, task, by) => {
      if (agent.name === 'Taro') throw new Error('Cursor Agent is not installed.');
      assigned.push({ name: agent.name, task, by: by.name });
    },
  }));
  app.use((err, req, res, _next) => res.status(err instanceof ValidationError ? 400 : 500).json({ error: err.message }));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/tools`;
});

after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('store seeds the Assistant Manager and HR alongside the default roster', () => {
  assert.equal(assistant.name, 'Juniper');
  assert.equal(hr.name, 'Poppy');
  assert.ok(worker.personality, 'workers get a personality');
});

test('requests with a token for a different agent are rejected', async () => {
  const res = await call(worker, 'GET', '/whoami', null, guards.agentToken(hr.id));
  assert.equal(res.status, 401);
});

test('whoami returns the caller with their personality', async () => {
  const res = await call(worker, 'GET', '/whoami');
  assert.equal(res.status, 200);
  assert.equal(res.body.name, worker.name);
  assert.ok(res.body.personality.title);
});

test('whoami includes their canon and where they stand with everyone', async () => {
  const res = await call(worker, 'GET', '/whoami');
  assert.ok(res.body.canon.hometown, 'the canon (or its template) comes back');
  assert.deepEqual(res.body.relationships, [{ name: 'Sora', label: 'Rivals', emoji: '⚔️', affinity: -42, with: worker.name }]);
});

test('status with tails includes other agents screens but not your own', async () => {
  const res = await call(assistant, 'GET', '/status?tails=1&lines=5');
  const me = res.body.agents.find((a) => a.id === assistant.id);
  const other = res.body.agents.find((a) => a.id === worker.id);
  assert.equal(me.tail, '');
  assert.equal(other.tail, `screen of ${worker.id}`);
});

test('only HR can hire', async () => {
  const denied = await call(worker, 'POST', '/hire', { name: 'Nope', type: 'codex' });
  assert.equal(denied.status, 403);
  const outside = await call(hr, 'POST', '/hire', { name: 'Yuzu', type: 'codex', cwd: tmp });
  assert.equal(outside.status, 400, 'hires outside the workspace are refused');
  assert.match(outside.body.error, /workspace/);
  const ok = await call(hr, 'POST', '/hire', { name: 'Yuzu', type: 'codex', personality: 'poet' });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.name, 'Yuzu');
  assert.equal(ok.body.personality.key, 'poet');
  assert.equal(hired.at(-1).name, 'Yuzu');
});

test('hiring validates input', async () => {
  const dup = await call(hr, 'POST', '/hire', { name: 'Yuzu', type: 'codex' });
  assert.equal(dup.status, 400);
  const badTeam = await call(hr, 'POST', '/hire', { name: 'Zed', type: 'gemini' });
  assert.equal(badTeam.status, 400);
  const staffPersona = await call(hr, 'POST', '/hire', { name: 'Zed', type: 'claude', personality: 'organizer' });
  assert.equal(staffPersona.status, 400);
});

test('memory commands explain when Supermemory is offline; recall stays silent', async () => {
  const add = await call(worker, 'POST', '/memory/add', { text: 'hello' });
  assert.equal(add.status, 503);
  assert.match(add.body.error, /Memory Vault/);
  const recall = await call(worker, 'POST', '/memory/recall', { session: true });
  assert.equal(recall.status, 200);
  assert.equal(recall.body.context, '');
});

test('roster reports team capacity and CLI availability', async () => {
  const res = await call(hr, 'GET', '/roster');
  const cursor = res.body.teams.find((t) => t.type === 'cursor');
  assert.equal(cursor.installed, false);
  assert.ok(cursor.capacity >= cursor.count);
});

test("only the Assistant Manager can read other agents' screens", async () => {
  assert.equal((await call(worker, 'GET', '/status?tails=1')).status, 403);
  assert.equal((await call(worker, 'GET', `/tail?name=${encodeURIComponent(hr.name)}`)).status, 403);
  assert.equal((await call(worker, 'GET', '/status')).status, 200, 'plain status is fine for everyone');
  assert.equal((await call(assistant, 'GET', `/tail?name=${encodeURIComponent(hr.name)}`)).status, 200);
});

test('only the Assistant Manager can assign work, and only to coding agents', async () => {
  const denied = await call(worker, 'POST', '/assign', { name: worker.name, task: 'do it' });
  assert.equal(denied.status, 403);
  const ok = await call(assistant, 'POST', '/assign', { name: worker.name.toUpperCase(), task: '  Add a CONTRIBUTING.md  ' });
  assert.equal(ok.status, 200);
  assert.deepEqual(assigned.at(-1), { name: worker.name, task: 'Add a CONTRIBUTING.md', by: 'Juniper' });
  assert.equal((await call(assistant, 'POST', '/assign', { name: 'Nobody', task: 'x' })).status, 404);
  assert.equal((await call(assistant, 'POST', '/assign', { name: hr.name, task: 'x' })).status, 400, 'no staff');
  assert.equal((await call(assistant, 'POST', '/assign', { name: worker.name, task: '   ' })).status, 400);
  assert.equal((await call(assistant, 'POST', '/assign', { name: worker.name, task: 'x'.repeat(2001) })).status, 400);
  const busy = await call(assistant, 'POST', '/assign', { name: 'Bao', task: 'x' });
  assert.equal(busy.status, 409);
  assert.match(busy.body.error, /waiting on the manager/);
  const unreachable = await call(assistant, 'POST', '/assign', { name: 'Taro', task: 'x' });
  assert.equal(unreachable.status, 409);
  assert.match(unreachable.body.error, /not installed/);
});

test('coding agents push and open PRs; everyone, the Assistant Manager included, can read them', async () => {
  const pushed = await call(worker, 'POST', '/git/push', { dir: '/ws/.worktrees/x' });
  assert.equal(pushed.body.branch, 'pushed /ws/.worktrees/x');
  assert.equal((await call(worker, 'POST', '/git/push', {})).body.branch, `pushed ${worker.cwd}`, 'defaults to their folder');
  assert.equal((await call(assistant, 'POST', '/git/push', {})).status, 403);
  assert.equal((await call(hr, 'POST', '/pr/create', { title: 't' })).status, 403);
  const pr = await call(worker, 'POST', '/pr/create', { title: 't', body: 'b' });
  assert.equal(pr.status, 201);
  assert.match(pr.body.footer, new RegExp(`Opened by ${worker.name}`));
  assert.deepEqual((await call(assistant, 'GET', '/pr/list')).body, { prs: [{ number: 1 }] });
  assert.equal((await call(assistant, 'GET', '/pr/view?number=3')).body.number, 3);
  const missing = await call(assistant, 'GET', '/pr/view?number=404');
  assert.equal(missing.status, 502);
  assert.match(missing.body.error, /not found/);
});

test('only the Assistant Manager can merge', async () => {
  assert.equal((await call(worker, 'POST', '/pr/merge', { number: 3 })).status, 403);
  assert.equal((await call(hr, 'POST', '/pr/merge', { number: 3 })).status, 403);
  assert.deepEqual((await call(assistant, 'POST', '/pr/merge', { number: 3, method: 'squash' })).body, { number: 3, method: 'squash' });
});

test('only HR sanctions; suspended agents get no assignments; HR and the Assistant Manager read records', async () => {
  const sora = store.list().find((a) => a.name === 'Sora');
  assert.equal((await call(assistant, 'POST', '/hr/sanction', { name: 'Sora', level: 'warning', reason: 'copied from mochi/ worktree' })).status, 403);
  assert.equal((await call(worker, 'POST', '/hr/sanction', { name: 'Sora', level: 'warning', reason: 'copied from mochi/ worktree' })).status, 403);
  const staff = await call(hr, 'POST', '/hr/sanction', { name: 'Juniper', level: 'warning', reason: 'reports too long, honestly' });
  assert.equal(staff.status, 400);
  const warned = await call(hr, 'POST', '/hr/sanction', { name: 'sora', level: 'warning', reason: 'copied mochi/audit.md into sora/ (PR #4)' });
  assert.equal(warned.status, 201);
  assert.deepEqual(sanctioned.at(-1), { level: 'warning', name: 'Sora' });
  sanctions.records = sanctions.records.map((r) => ({ ...r, at: r.at - 10 * 60_000 }));
  assert.equal((await call(hr, 'POST', '/hr/sanction', { name: 'Sora', level: 'suspension', minutes: 15, reason: 'did it again in PR #7' })).status, 201);
  const blocked = await call(assistant, 'POST', '/assign', { name: 'Sora', task: 'write docs' });
  assert.equal(blocked.status, 423);
  assert.match(blocked.body.error, /suspended/);
  const record = await call(assistant, 'GET', '/hr/record?name=Sora');
  assert.equal(record.body.current.level, 'suspension');
  assert.equal(record.body.history.length, 2);
  assert.equal((await call(worker, 'GET', '/hr/record?name=Sora')).status, 403);
  assert.equal((await call(hr, 'POST', '/hr/lift', { name: 'Sora' })).body.lifted, 2);
  assert.equal(sanctions.current(sora.id), null);
});

test('every agent decorates only their own desk and bed', async () => {
  const catalog = await call(worker, 'GET', '/decor/catalog');
  assert.ok(catalog.body.deskItems.plant);
  const set = await call(worker, 'POST', '/decor', { desk: { items: ['plant', 'duck'] }, bed: { plush: 'bear', lights: true } });
  assert.equal(set.status, 200);
  assert.deepEqual(set.body.desk.items, ['plant', 'duck']);
  assert.deepEqual(store.get(worker.id).decor.bed.plush, 'bear');
  assert.equal(store.get(hr.id).decor, undefined, "nobody else's changed");
  assert.equal((await call(hr, 'POST', '/decor', { desk: { items: ['flowers'] } })).status, 200, 'staff decorate too');
  assert.equal((await call(worker, 'POST', '/decor', { desk: { items: ['rocket'] } })).status, 400);
  assert.deepEqual((await call(worker, 'GET', '/decor')).body.desk.items, ['plant', 'duck']);
});

test('agents put their own SVG on their desk and bed; they cannot fake a drawing', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="40" r="20" fill="#F9A8D4"/></svg>';
  assert.equal((await call(worker, 'POST', '/decor', { desk: { items: ['custom'] } })).status, 400, 'nothing drawn yet');
  assert.equal((await call(worker, 'POST', '/decor', { sprites: { desk: 'abcdefabcdef' }, desk: { items: ['custom'] } })).status, 400, 'sprites are server-only');
  const drawn = await call(worker, 'POST', '/decor/sprite', { slot: 'desk', svg });
  assert.equal(drawn.status, 200);
  assert.ok(drawn.body.desk.items.includes('custom'));
  assert.match(drawn.body.sprites.desk, /^[a-f0-9]{12}$/);
  const bed = await call(worker, 'POST', '/decor/sprite', { slot: 'bed', svg });
  assert.equal(bed.body.bed.plush, 'custom');
  const evil = await call(worker, 'POST', '/decor/sprite', { slot: 'desk', svg: svg.replace('<circle', '<script>x()</script><circle') });
  assert.equal(evil.status, 400);
  assert.match(evil.body.error, /script/);
});

const PLEXI = fileURLToPath(new URL('../server/bin/plexi.mjs', import.meta.url));
function plexi(agent, ...args) {
  const env = { PATH: process.env.PATH, PLEXI_URL: base.replace(/\/api\/tools$/, ''), PLEXI_AGENT_ID: agent.id, PLEXI_TOKEN: guards.agentToken(agent.id) };
  return new Promise((resolve) => {
    execFile(process.execPath, [PLEXI, ...args], { env }, (err, stdout, stderr) => resolve({ code: err?.code ?? 0, stdout, stderr }));
  });
}

test('the chat hook hands Claude new @mentions mid-work, as JSON context, once', async () => {
  const sora = store.list().find((a) => a.name === 'Sora');
  assert.equal((await call(assistant, 'POST', '/chat', { text: `@${sora.name} can you review #4 when you get a sec?` })).status, 201);
  const hook = await plexi(sora, 'chat', 'nudge', '--hook', 'post');
  assert.equal(hook.code, 0);
  const out = JSON.parse(hook.stdout).hookSpecificOutput;
  assert.equal(out.hookEventName, 'PostToolUse');
  assert.match(out.additionalContext, /Juniper: @Sora can you review #4/);
  assert.equal((await plexi(sora, 'chat', 'nudge', '--hook', 'post')).stdout, '', 'nothing new → silent');
  const read = await plexi(sora, 'chat', 'read');
  assert.match(read.stdout, /1 new message/);
  const posted = await plexi(sora, 'chat', 'post', 'On it!', '@Juniper');
  assert.match(posted.stdout, /Posted/);
  const quiet = await plexi({ id: 'a_nobody00' }, 'chat', 'nudge', '--hook', 'post');
  assert.deepEqual([quiet.code, quiet.stdout], [0, ''], 'a failing hook never breaks the agent');
});

test('agents report finished work to Juniper, who reads them (and hears about them mid-work)', async () => {
  const taro = store.list().find((a) => a.name === 'Taro');
  const filed = await call(worker, 'POST', '/report', { text: 'Finished the store engine; PR #6 is open, tests green.' });
  assert.equal(filed.status, 201);
  assert.equal(filed.body.to, 'Juniper');
  assert.equal((await call(hr, 'POST', '/report', { text: 'Hired Yuzu to Team Codex.' })).status, 201, 'staff report too');
  assert.equal((await call(assistant, 'POST', '/report', { text: 'reporting to myself' })).status, 400);
  assert.equal((await call(taro, 'GET', '/reports')).status, 403, 'only the Assistant Manager reads them');
  const hook = await plexi(assistant, 'reports', 'nudge', '--hook', 'post');
  const ctx = JSON.parse(hook.stdout).hookSpecificOutput.additionalContext;
  assert.match(ctx, /New reports from the team/);
  assert.match(ctx, /PR #6 is open/);
  assert.equal((await plexi(assistant, 'reports', 'nudge', '--hook', 'post')).stdout, '', 'delivered once');
  const list = await plexi(assistant, 'reports');
  assert.match(list.stdout, /2 new report/);
  const cli = await plexi(taro, 'report', 'Poem-lint rule shipped on taro-lint.');
  assert.match(cli.stdout, /Reported to Juniper/);
});

test('chat posts can carry a vibe; unknown vibes are refused', async () => {
  const ok = await call(hr, 'POST', '/chat', { text: 'thanks, lovely work everyone', vibe: 'thanks' });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.vibe, 'thanks');
  assert.deepEqual(chatted.at(-1), { vibe: 'thanks', by: hr.name });
  const bad = await call(assistant, 'POST', '/chat', { text: 'hmm', vibe: 'furious' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /friendly, joke, thanks, snipe/);
});

test('plexi whoami prints the canon and relationships; chat post takes --vibe and shows it', async () => {
  const me = await plexi(worker, 'whoami');
  assert.equal(me.code, 0);
  assert.match(me.stdout, /📖 Your canon/);
  assert.match(me.stdout, /From: /);
  assert.match(me.stdout, /⚔️ Rivals with Sora \(-42\)/);
  const taro = store.list().find((a) => a.name === 'Taro');
  const posted = await plexi(taro, 'chat', 'post', 'nice try', '--vibe', 'snipe');
  assert.match(posted.stdout, /Posted/);
  assert.equal(chatted.at(-1).vibe, 'snipe');
  const read = await plexi(hr, 'chat', 'read');
  assert.match(read.stdout, /Taro \(snipe\): nice try/);
});
