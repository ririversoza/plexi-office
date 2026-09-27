import express from 'express';
import { AGENT_TYPES, MAX_AGENTS_PER_TYPE } from './config.js';
import { ARCHETYPES, describePersonality, workerArchetypes } from './personality.js';
import { OFFICE_TAG, agentTag } from './memory.js';
import { GitError } from './github.js';
import { COLORS, DESK_ITEMS, EMPTY_DECOR, MAX_DESK_ITEMS, PLUSHIES } from './decor.js';
import { SPRITE_SLOTS } from './sprites.js';
import { CHAT_VIBES } from './relationships.js';

export const ROLE_LABELS = { worker: 'Agent', assistant: 'Assistant Manager', hr: 'HR' };
const MAX_TAIL_LINES = 200;
const MIN_RECALL_PROMPT = 8;
const MAX_TASK_CHARS = 2000;

export function teamLabel(agent) {
  return agent.role === 'worker' ? AGENT_TYPES[agent.type].team : 'Office Staff';
}

class ToolError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function clampLines(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(1, Math.min(MAX_TAIL_LINES, Math.floor(n))) : fallback;
}

function formatRecall(hits, heading) {
  if (!hits.length) return '';
  const lines = hits.map((h) => `- ${h.scope === 'office' ? '[office] ' : ''}${h.text.replace(/\s+/g, ' ').slice(0, 400)}`);
  return `<plexi-memory>\n${heading}\n${lines.join('\n')}\n</plexi-memory>`;
}

/**
 * /api/tools — called by the `plexi` helper inside agent terminals.
 * Every request is authenticated as a specific agent (req.agent).
 */
export function createToolsRouter({ store, sessions, statusOf, memory, guards, getClis, onHire, onAssign, onMerge, onSanction, onLift, onDecor, onChat, chat, relationshipsOf = () => [], reports, onReport, sprites, sanctions, github }) {
  const router = express.Router();
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  router.use(guards.agentGuard, (req, res, next) => {
    req.agent = store.get(req.agentId);
    if (!req.agent) return res.status(401).json({ error: 'Unknown agent' });
    next();
  });

  const requireMemory = () => {
    if (!memory.connected) {
      throw new ToolError(503, 'Supermemory is not connected. Ask the manager to start the Memory Vault in the office.');
    }
  };

  const view = (agent) => ({
    id: agent.id,
    name: agent.name,
    role: agent.role,
    roleLabel: ROLE_LABELS[agent.role],
    team: teamLabel(agent),
    type: agent.type,
    cwd: agent.cwd,
    personality: { key: agent.personality, ...describePersonality(agent.personality) },
  });

  router.get('/whoami', (req, res) => res.json({
    ...view(req.agent), canon: req.agent.canon || {}, relationships: relationshipsOf(req.agent),
  }));

  router.get('/status', (req, res) => {
    const withTails = req.query.tails === '1';
    if (withTails && req.agent.role !== 'assistant') throw new ToolError(403, "Only the Assistant Manager can read other agents' screens.");
    const lines = clampLines(req.query.lines, 12);
    const agents = store.list().map((agent) => {
      const status = statusOf(agent.id);
      return {
        ...view(agent),
        state: status.state,
        detail: status.detail,
        since: status.since,
        tail: withTails && agent.id !== req.agent.id ? sessions.screenText(agent.id, lines) : '',
      };
    });
    res.json({ agents });
  });

  router.get('/tail', (req, res) => {
    if (req.agent.role !== 'assistant') throw new ToolError(403, "Only the Assistant Manager can read other agents' screens.");
    const wanted = String(req.query.name || '').trim().toLowerCase();
    const agent = store.list().find((a) => a.name.toLowerCase() === wanted);
    if (!agent) throw new ToolError(404, `No agent named "${req.query.name}".`);
    res.json({ name: agent.name, text: sessions.screenText(agent.id, clampLines(req.query.lines, 40)) });
  });

  router.post('/memory/add', wrap(async (req, res) => {
    requireMemory();
    const office = req.body?.scope === 'office';
    await memory.add(office ? OFFICE_TAG : agentTag(req.agent.id), `${req.agent.name}: ${req.body?.text ?? ''}`, {
      agent: req.agent.name, team: teamLabel(req.agent), cwd: req.agent.cwd, source: 'plexi-memory-add',
    });
    res.json({ ok: true });
  }));

  router.post('/memory/search', wrap(async (req, res) => {
    requireMemory();
    const tags = req.body?.scope === 'all' ? [agentTag(req.agent.id), OFFICE_TAG] : [agentTag(req.agent.id)];
    res.json({ results: await memory.search(tags, req.body?.q, { limit: 8 }) });
  }));

  router.post('/memory/recall', wrap(async (req, res) => {
    if (!memory.connected) return res.json({ context: '' });
    const tags = [agentTag(req.agent.id), OFFICE_TAG];
    if (req.body?.session) {
      const q = `${req.agent.name}: project context, decisions, conventions, preferences, recent work in ${req.agent.cwd}`;
      const hits = await memory.search(tags, q, { limit: 8, threshold: 0.3 });
      return res.json({ context: formatRecall(hits, 'Memories from previous sessions (Supermemory):') });
    }
    const prompt = String(req.body?.prompt || '');
    if (prompt.length < MIN_RECALL_PROMPT) return res.json({ context: '' });
    const hits = await memory.search(tags, prompt, { limit: 5, threshold: 0.6 });
    res.json({ context: formatRecall(hits, 'Possibly relevant memories (Supermemory):') });
  }));

  router.get('/roster', wrap(async (req, res) => {
    const clis = await getClis();
    const teams = Object.entries(AGENT_TYPES).map(([type, def]) => {
      const members = store.list().filter((a) => a.role === 'worker' && a.type === type);
      return {
        type,
        label: def.team,
        bin: def.bin,
        installed: Boolean(clis[type]?.installed),
        count: members.length,
        capacity: MAX_AGENTS_PER_TYPE,
        members: members.map((m) => `${m.name} (${describePersonality(m.personality).title})`),
      };
    });
    res.json({ teams });
  }));

  router.get('/personalities', (req, res) => {
    res.json({ personalities: workerArchetypes().map((key) => ({ key, ...ARCHETYPES[key] })) });
  });

  router.post('/hire', (req, res) => {
    if (req.agent.role !== 'hr') throw new ToolError(403, 'Only HR can hire. Ask Poppy!');
    const hired = store.create(req.body || {});
    onHire(hired, req.agent);
    res.status(201).json(view(hired));
  });

  const byName = (value) => {
    const wanted = String(value || '').trim().toLowerCase();
    const found = store.list().find((a) => a.name.toLowerCase() === wanted);
    if (!found) throw new ToolError(404, `No agent named "${value}".`);
    return found;
  };

  // ── HR: warnings and suspensions (see sanctions.js). The Assistant Manager can read records too.
  router.post('/hr/sanction', wrap(async (req, res) => {
    if (req.agent.role !== 'hr') throw new ToolError(403, 'Only HR can sanction agents.');
    const target = byName(req.body?.name);
    const record = sanctions.issue({
      agent: target, level: req.body?.level, reason: req.body?.reason, minutes: req.body?.minutes, by: req.agent.name,
    });
    await onSanction(record, target, req.agent);
    res.status(201).json({ ...record, name: target.name });
  }));

  router.post('/hr/lift', wrap(async (req, res) => {
    if (req.agent.role !== 'hr') throw new ToolError(403, 'Only HR can lift sanctions.');
    const target = byName(req.body?.name);
    const lifted = sanctions.lift({ agentId: target.id, by: req.agent.name });
    if (!lifted.length) throw new ToolError(404, `${target.name} has nothing active on their record.`);
    onLift(target, req.agent.name);
    res.json({ name: target.name, lifted: lifted.length });
  }));

  router.get('/hr/record', (req, res) => {
    if (!['hr', 'assistant'].includes(req.agent.role)) throw new ToolError(403, 'Only HR and the Assistant Manager can read HR records.');
    const target = byName(req.query.name);
    res.json({ name: target.name, current: sanctions.current(target.id), history: sanctions.history(target.id) });
  });

  // ── Group chat: everyone posts and reads; @mentions and manager messages reach Claude agents mid-work.
  // A vibe says how the post is meant, which is how it lands with anyone it @mentions.
  router.post('/chat', (req, res) => {
    const vibe = req.body?.vibe;
    if (vibe !== undefined && !Object.hasOwn(CHAT_VIBES, vibe)) {
      throw new ToolError(400, `Vibe must be one of: ${Object.keys(CHAT_VIBES).join(', ')}.`);
    }
    const message = chat.post({
      from: req.agent.id, name: req.agent.name, text: req.body?.text, agents: store.list(), meta: vibe ? { vibe } : {},
    });
    onChat?.(message, req.agent);
    res.status(201).json(message);
  });

  router.get('/chat', (req, res) => {
    res.json(chat.readFor(req.agent.id, clampLines(req.query.limit, 30)));
  });

  router.get('/chat/nudge', (req, res) => res.json(chat.nudgesFor(req.agent.id)));

  // ── Reports: everyone else reports finished work to the Assistant Manager, who reads them here.
  const assistant = () => store.list().find((a) => a.role === 'assistant');
  const requireAssistant = (req) => {
    if (req.agent.role !== 'assistant') throw new ToolError(403, 'Only the Assistant Manager reads reports.');
  };

  router.post('/report', (req, res) => {
    const to = assistant();
    if (!to) throw new ToolError(503, 'There is no Assistant Manager to report to.');
    if (req.agent.id === to.id) throw new ToolError(400, "You're the one receiving reports; tell the manager directly.");
    const message = reports.post({ from: req.agent.id, name: req.agent.name, text: req.body?.text, to: [to.id], meta: { auto: false } });
    onReport?.(message, req.agent);
    res.status(201).json({ ...message, to: to.name });
  });

  router.get('/reports', (req, res) => {
    requireAssistant(req);
    res.json(reports.readFor(req.agent.id, clampLines(req.query.limit, 30)));
  });

  router.get('/reports/nudge', (req, res) => {
    requireAssistant(req);
    res.json(reports.nudgesFor(req.agent.id));
  });

  // ── Decor: every agent (staff too) decorates their own desk and bed, nobody else's.
  router.get('/decor/catalog', (req, res) => {
    res.json({ deskItems: DESK_ITEMS, maxDeskItems: MAX_DESK_ITEMS, plushies: PLUSHIES, colors: Object.keys(COLORS) });
  });

  router.get('/decor', (req, res) => res.json(req.agent.decor || EMPTY_DECOR));

  router.post('/decor', (req, res) => {
    const { sprites: _ignored, ...changes } = req.body || {};
    const updated = store.update(req.agent.id, { decor: changes });
    onDecor?.(updated);
    res.json(updated.decor);
  });

  /** Their own SVG for the desk or the bed; it goes straight on (a desk slot, or the plushie spot). */
  router.post('/decor/sprite', (req, res) => {
    const slot = String(req.body?.slot || '');
    if (!SPRITE_SLOTS.includes(slot)) throw new ToolError(400, `Slot must be one of: ${SPRITE_SLOTS.join(', ')}.`);
    const version = sprites.save(req.agent.id, slot, req.body?.svg);
    const current = { ...EMPTY_DECOR, ...(req.agent.decor || {}) };
    const items = current.desk?.items || [];
    const change = slot === 'desk'
      ? { desk: { items: items.includes('custom') ? items : [...items, 'custom'].slice(-MAX_DESK_ITEMS) } }
      : { bed: { plush: 'custom' } };
    const updated = store.update(req.agent.id, { decor: change, sprites: { [slot]: version } });
    onDecor?.(updated);
    res.json(updated.decor);
  });

  /** The Assistant Manager hands a task to a coding agent: it's typed into their terminal. */
  router.post('/assign', wrap(async (req, res) => {
    if (req.agent.role !== 'assistant') throw new ToolError(403, 'Only the Assistant Manager can assign work.');
    const target = byName(req.body?.name);
    if (target.role !== 'worker') throw new ToolError(400, `${target.name} is office staff; only coding agents take assignments.`);
    const task = String(req.body?.task || '').trim();
    if (!task) throw new ToolError(400, 'The task is empty.');
    if (task.length > MAX_TASK_CHARS) throw new ToolError(400, `Keep the task under ${MAX_TASK_CHARS} characters.`);
    const suspended = sanctions?.suspension(target.id);
    if (suspended) throw new ToolError(423, `${target.name} is suspended by HR until ${new Date(suspended.until).toLocaleTimeString()}.`);
    // Typing into a question or permission prompt could answer it by accident.
    if (statusOf(target.id).state === 'question') {
      throw new ToolError(409, `${target.name} is waiting on the manager right now; assign after they're answered.`);
    }
    try {
      await onAssign(target, task, req.agent);
    } catch (err) {
      throw new ToolError(409, `Could not reach ${target.name}: ${err.message}`);
    }
    res.json({ ok: true, name: target.name, state: statusOf(target.id).state });
  }));

  // ── GitHub: coding agents push and open PRs; anyone (the Assistant Manager included) can read them.
  const requireWorker = (req) => {
    if (req.agent.role !== 'worker') throw new ToolError(403, 'Only coding agents push branches and open PRs.');
  };
  const folder = (req) => String(req.body?.dir || req.agent.cwd);

  router.post('/git/push', wrap(async (req, res) => {
    requireWorker(req);
    res.json(await github.push(folder(req)));
  }));

  router.post('/git/fetch', wrap(async (req, res) => {
    requireWorker(req);
    res.json(await github.fetch(folder(req)));
  }));

  router.post('/pr/create', wrap(async (req, res) => {
    requireWorker(req);
    const footer = `\n\n---\n🤖 Opened by ${req.agent.name} (${teamLabel(req.agent)}) via Plexi Office.`;
    res.status(201).json(await github.createPr(folder(req), { ...req.body, draft: Boolean(req.body?.draft), footer }));
  }));

  router.post('/pr/merge', wrap(async (req, res) => {
    if (req.agent.role !== 'assistant') throw new ToolError(403, 'Only the Assistant Manager can merge PRs.');
    const merged = await github.mergePr(req.body?.number, { method: req.body?.method || 'merge' });
    onMerge?.(merged, req.agent);
    res.json(merged);
  }));

  router.get('/pr/list', wrap(async (req, res) => res.json({ prs: await github.listPrs() })));

  router.get('/pr/view', wrap(async (req, res) => {
    res.json(await github.viewPr(req.query.number, { diff: req.query.diff === '1' }));
  }));

  router.use((err, req, res, next) => {
    if (err instanceof GitError) return res.status(err.status).json({ error: err.message });
    if (err instanceof ToolError) return res.status(err.status).json({ error: err.message });
    next(err);
  });

  return router;
}
