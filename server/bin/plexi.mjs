#!/usr/bin/env node
/**
 * `plexi` — the office helper every agent has on PATH.
 * Talks to the Plexi Office server with this agent's identity (env set at launch).
 */
import { readFileSync } from 'node:fs';

const { PLEXI_URL, PLEXI_AGENT_ID, PLEXI_TOKEN } = process.env;

const HELP = `plexi — Plexi Office helper

  plexi whoami                         your name, team, role, personality, canon and relationships
  plexi status [--tails] [--lines N]   every agent's state (and last terminal lines)
  plexi tail <name> [--lines N]        what's on one agent's screen
  plexi assign <name> <task>           hand a coding agent a task (Assistant Manager only)
  plexi push                           push your current branch to GitHub (never main, never forced)
  plexi fetch                          fetch the latest from GitHub
  plexi pr create --title T [--body B | --body-file F] [--draft]   open a PR from your branch into main
  plexi pr list                        open PRs
  plexi pr view <number> [--diff]      one PR: description, files, reviews (and the diff)
  plexi pr merge <number> [--squash|--rebase]   merge a PR into main (Assistant Manager only)
  plexi report <what you did>          report finished work to the Assistant Manager
  plexi reports [--limit N]            reports you haven't read yet (Assistant Manager only)
  plexi chat read [--limit N]          the office group chat (what you haven't seen yet)
  plexi chat post <message> [--vibe friendly|joke|thanks|snipe]   post to the group chat; @Name mentions someone, @all everyone
  plexi decor catalog                  what you can put on your desk and bed
  plexi decor show                     your current decorations
  plexi decor set [--desk plant,lamp,duck] [--desk-color C] [--blanket C] [--pillow C] [--plush cat] [--lights on|off]
  plexi decor draw --desk FILE.svg | --bed FILE.svg   put your own SVG drawing on your desk or bed
  plexi sanction warn <name> --reason R                     warn an agent (HR only)
  plexi sanction suspend <name> [--minutes N] --reason R    suspend after a warning, 5–240 min (HR only)
  plexi sanction lift <name>                                clear an agent's active sanctions (HR only)
  plexi sanction record <name>                              an agent's HR record (HR and Assistant Manager)
  plexi memory search [--office] <q>   recall from your Supermemory (plus office notes)
  plexi memory add [--office] <text>   remember something (office = shared with everyone)
  plexi roster                         teams, open desks, installed CLIs
  plexi personalities                  personality keys for hiring
  plexi hire --name N --team claude|codex|cursor [--cwd DIR] [--personality KEY]   (HR only)
`;

const STATE_ICONS = { working: '💻', break: '☕', question: '🙋', conflict: '⚔️', offline: '💤' };
const STATE_WORDS = {
  working: 'working', break: 'on break', question: 'waiting on the manager', conflict: 'in the Merge Conflict Room', offline: 'offline',
};
const BOOLEAN_FLAGS = new Set(['tails', 'office', 'session', 'draft', 'diff', 'squash', 'rebase']);

function parseArgs(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      rest.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!BOOLEAN_FLAGS.has(key) && next !== undefined && !next.startsWith('--')) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }
  return { flags, rest };
}

async function call(method, path, body) {
  if (!PLEXI_URL || !PLEXI_AGENT_ID || !PLEXI_TOKEN) {
    throw new Error('plexi only works inside an agent launched by Plexi Office.');
  }
  const res = await fetch(`${PLEXI_URL}/api/tools${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-plexi-agent': PLEXI_AGENT_ID, 'x-plexi-token': PLEXI_TOKEN },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `office server said ${res.status}`);
  return data;
}

function ago(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

function indent(text, pad = '      │ ') {
  return text.split('\n').map((l) => pad + l).join('\n');
}

function printStatus({ agents }, withTails) {
  const needsManager = agents.filter((a) => a.state === 'question' || a.state === 'conflict');
  console.log(`📋 Office status — ${agents.length} agents, ${needsManager.length} need the manager\n`);
  for (const a of agents) {
    const who = `${a.name} (${a.team}${a.role !== 'worker' ? `, ${a.roleLabel}` : ''})`;
    const detail = a.detail ? ` — "${a.detail}"` : '';
    console.log(`  ${STATE_ICONS[a.state] || '•'} ${who}: ${STATE_WORDS[a.state] || a.state} for ${ago(a.since)}${detail}`);
    console.log(`      cwd: ${a.cwd}`);
    if (withTails && a.tail) console.log(indent(a.tail));
  }
}

async function readHookPayload() {
  if (process.stdin.isTTY) return {};
  try {
    const chunks = [];
    const timer = setTimeout(() => process.stdin.destroy(), 800);
    for await (const chunk of process.stdin) chunks.push(chunk);
    clearTimeout(timer);
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    return {};
  }
}

/** Hook mode: prints memory context for Claude Code; must never fail loudly. */
async function recall(flags) {
  const payload = await readHookPayload();
  try {
    const { context } = await call('POST', '/memory/recall', { session: Boolean(flags.session), prompt: payload.prompt || '' });
    if (context) process.stdout.write(`${context}\n`);
  } catch {
    // memory offline — say nothing
  }
}

async function memory(rest, flags) {
  const [sub, ...words] = rest;
  const text = words.join(' ').trim();
  if (sub === 'add' && text) {
    await call('POST', '/memory/add', { text, scope: flags.office ? 'office' : 'self' });
    console.log(flags.office ? '🧠 Saved to office memory.' : '🧠 Saved to your memory.');
    return;
  }
  if (sub === 'search' && text) {
    const { results } = await call('POST', '/memory/search', { q: text, scope: flags.office ? 'all' : 'self' });
    if (!results.length) console.log('No memories found.');
    for (const r of results) console.log(`• [${r.scope} ${(r.similarity * 100).toFixed(0)}%] ${r.text}`);
    return;
  }
  throw new Error('usage: plexi memory add|search [--office] <text>');
}

/** "✅ ready to merge" or what's in the way, plus CI and conflicts. */
function healthLine(h) {
  if (!h) return '';
  const ci = h.checks.total === 0 ? 'no CI checks'
    : h.checks.failed.length ? `❌ failing: ${h.checks.failed.join(', ')}`
      : h.checks.pending.length ? `⏳ running: ${h.checks.pending.join(', ')}`
        : `✅ ${h.checks.passed} check(s) passed`;
  const conflicts = { none: 'no conflicts with main', conflicts: '⚠️ conflicts with main', unknown: 'conflicts: GitHub still checking' }[h.conflicts];
  const verdict = h.blocker ? `🚫 not mergeable: ${h.blocker.replace(/^#\d+ /, '')}` : '✅ ready to merge';
  return `${h.draft ? '📝 draft · ' : ''}${conflicts} · ${ci} · ${verdict}`;
}

function printPr(pr) {
  const who = pr.author?.login ? ` by ${pr.author.login}` : '';
  console.log(`#${pr.number} ${pr.title}${pr.isDraft ? ' (draft)' : ''}\n${pr.headRefName} → ${pr.baseRefName}${who} · ${pr.state} · +${pr.additions}/-${pr.deletions}\n${pr.url}\n`);
  if (pr.health) console.log(`${healthLine(pr.health)}\n`);
  if (pr.body) console.log(`${pr.body}\n`);
  if (pr.files?.length) console.log(`Files:\n${pr.files.map((f) => `  ${f.path} (+${f.additions}/-${f.deletions})`).join('\n')}\n`);
  for (const r of pr.reviews || []) console.log(`Review from ${r.author?.login}: ${r.state}${r.body ? ` — ${r.body}` : ''}`);
  for (const c of pr.comments || []) console.log(`Comment from ${c.author?.login}: ${c.body}`);
  if (pr.diff) console.log(`\n${pr.diff}`);
}

async function pr(rest, flags) {
  const [sub, number] = rest;
  if (sub === 'create') {
    if (!flags.title || flags.title === true) throw new Error('usage: plexi pr create --title "..." [--body "..." | --body-file FILE] [--draft]');
    const body = flags['body-file'] ? readFileSync(String(flags['body-file']), 'utf8') : flags.body === true ? '' : String(flags.body ?? '');
    const made = await call('POST', '/pr/create', { dir: process.cwd(), title: String(flags.title), body, draft: Boolean(flags.draft) });
    console.log(`🔀 Opened a PR from ${made.branch}: ${made.url}`);
    return;
  }
  if (sub === 'list') {
    const { prs } = await call('GET', '/pr/list');
    if (!prs.length) console.log('No open PRs.');
    for (const p of prs) {
      const review = p.reviewDecision ? ` · ${p.reviewDecision.toLowerCase().replace(/_/g, ' ')}` : '';
      console.log(`#${p.number} ${p.title}${p.isDraft ? ' (draft)' : ''} — ${p.headRefName}${review}\n   ${healthLine(p.health)}\n   ${p.url}`);
    }
    return;
  }
  if (sub === 'merge' && number) {
    const method = flags.squash ? 'squash' : flags.rebase ? 'rebase' : 'merge';
    const done = await call('POST', '/pr/merge', { number, method });
    console.log(`🔀 Merged #${done.number} "${done.title}" into main (${done.method}). ${done.main}.\n${done.url}`);
    return;
  }
  if (sub === 'view' && number) {
    printPr(await call('GET', `/pr/view?number=${encodeURIComponent(number)}&diff=${flags.diff ? 1 : 0}`));
    return;
  }
  throw new Error('usage: plexi pr create|list|view <number> [--diff]|merge <number> [--squash|--rebase]');
}

function describeRecord(r) {
  const when = new Date(r.at).toLocaleString();
  const state = r.liftedAt ? `lifted by ${r.liftedBy}` : r.until > Date.now() ? `until ${new Date(r.until).toLocaleString()}` : 'expired';
  return `${r.level === 'suspension' ? '⛔' : '⚠️'} ${r.level} from ${r.by} on ${when} (${state}): ${r.reason}`;
}

async function sanction(rest, flags) {
  const [sub, ...nameParts] = rest;
  const name = nameParts.join(' ');
  if (!name) throw new Error('usage: plexi sanction warn|suspend|lift|record <name> [--minutes N] [--reason "..."]');
  if (sub === 'warn' || sub === 'suspend') {
    if (!flags.reason || flags.reason === true) throw new Error('A sanction needs --reason "what they did, and where".');
    const level = sub === 'warn' ? 'warning' : 'suspension';
    const minutes = flags.minutes === undefined ? undefined : Number(flags.minutes);
    const r = await call('POST', '/hr/sanction', { name, level, reason: String(flags.reason), minutes });
    const tail = level === 'suspension' ? `They're clocked out until ${new Date(r.until).toLocaleTimeString()}.` : "They've been told why.";
    console.log(`${level === 'suspension' ? '⛔ Suspended' : '⚠️  Warned'} ${r.name}. ${tail} Let the manager know.`);
    return;
  }
  if (sub === 'lift') {
    const r = await call('POST', '/hr/lift', { name });
    console.log(`✅ Lifted ${r.lifted} sanction(s) on ${r.name}.`);
    return;
  }
  if (sub === 'record') {
    const r = await call('GET', `/hr/record?name=${encodeURIComponent(name)}`);
    console.log(r.history.length ? `${r.name}'s HR record:\n${r.history.map((h) => `  ${describeRecord(h)}`).join('\n')}` : `${r.name} has a clean record.`);
    return;
  }
  throw new Error('usage: plexi sanction warn|suspend|lift|record <name>');
}

function describeDecor(d) {
  const desk = d.desk.items.length ? d.desk.items.join(', ') : 'nothing yet';
  const bed = [d.bed.blanket && `${d.bed.blanket} blanket`, d.bed.pillow && `${d.bed.pillow} pillow`,
    d.bed.plush === 'custom' ? 'your own drawing' : d.bed.plush !== 'none' && `a ${d.bed.plush} plushie`, d.bed.lights && 'fairy lights'].filter(Boolean).join(', ') || 'plain';
  return `🪴 Desk: ${desk}${d.desk.color ? ` (${d.desk.color} accents)` : ''}\n🛏️  Bed: ${bed}`;
}

async function decor(rest, flags) {
  const [sub] = rest;
  if (sub === 'catalog') {
    const c = await call('GET', '/decor/catalog');
    console.log(`Desk items (up to ${c.maxDeskItems}):\n${Object.entries(c.deskItems).map(([k, v]) => `  ${k.padEnd(9)} ${v}`).join('\n')}`);
    console.log(`Plushies: ${Object.keys(c.plushies).join(', ')}\nColours: ${c.colors.join(', ')}`);
    return;
  }
  if (sub === 'show') {
    console.log(describeDecor(await call('GET', '/decor')));
    return;
  }
  if (sub === 'draw') {
    const slot = flags.desk && flags.desk !== true ? 'desk' : flags.bed && flags.bed !== true ? 'bed' : null;
    if (!slot) throw new Error('usage: plexi decor draw --desk FILE.svg | --bed FILE.svg');
    const svg = readFileSync(String(flags[slot]), 'utf8');
    const d = await call('POST', '/decor/sprite', { slot, svg });
    console.log(`🎨 Your drawing is on your ${slot} now.\n${describeDecor(d)}`);
    return;
  }
  if (sub === 'set') {
    const has = (k) => flags[k] !== undefined && flags[k] !== true;
    const body = {
      desk: { ...(has('desk') && { items: String(flags.desk).split(',') }), ...(has('desk-color') && { color: String(flags['desk-color']) }) },
      bed: {
        ...(has('blanket') && { blanket: String(flags.blanket) }),
        ...(has('pillow') && { pillow: String(flags.pillow) }),
        ...(has('plush') && { plush: String(flags.plush) }),
        ...(has('lights') && { lights: /^(on|yes|true|1)$/i.test(String(flags.lights)) }),
      },
    };
    console.log(`✨ Decorated!\n${describeDecor(await call('POST', '/decor', body))}`);
    return;
  }
  throw new Error('usage: plexi decor catalog|show|set [--desk a,b,c] [--desk-color C] [--blanket C] [--pillow C] [--plush P] [--lights on|off]');
}

function chatLine(m) {
  const time = new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `[${time}] ${m.name}${m.vibe ? ` (${m.vibe})` : ''}: ${m.text}`;
}

function describeCanon(c) {
  const list = (v) => (v || []).join(', ') || '—';
  return [
    '📖 Your canon (it flavours how you talk, never your work)',
    `Pronouns: ${c.pronouns || 'they/them'}`,
    `From: ${c.hometown || '—'}`,
    c.backstory,
    `Speaks: ${c.speechStyle || '—'}. Quirk: ${c.quirk || '—'}`,
    `Hobbies: ${list(c.hobbies)}. Likes: ${list(c.likes)}. Dislikes: ${list(c.dislikes)}`,
    `Secret: ${c.secret || '—'}. Goal: ${c.goal || '—'}`,
  ].filter(Boolean).join('\n');
}

function describeRelationships(rels) {
  if (!rels.length) return '💞 Your relationships: none yet. They grow from chatting and working together.';
  return ['💞 Your relationships', ...rels.map((r) => `${r.emoji} ${r.label} with ${r.name} (${r.affinity})`)].join('\n');
}

const NUDGES = {
  chat: {
    path: '/chat/nudge',
    heading: '💬 Office group chat, new for you:',
    more: 'plexi chat read',
    footer: 'Reply with plexi chat post "..." if it needs an answer, then carry on with your work.',
  },
  reports: {
    path: '/reports/nudge',
    heading: '📝 New reports from the team:',
    more: 'plexi reports',
    footer: 'Keep these for your progress report. If one says someone is blocked or has a PR ready, let the manager know; otherwise carry on.',
  },
};

/** Hook mode (Claude Code): prints what's new for them; silent otherwise and on any error. */
async function nudge(kind, when) {
  const n = NUDGES[kind];
  try {
    const { messages, unread } = await call('GET', n.path);
    if (!messages.length) return;
    const more = unread > messages.length ? `\n(${unread - messages.length} more unread: ${n.more})` : '';
    const text = `${n.heading}\n${messages.map(chatLine).join('\n')}${more}\n${n.footer}`;
    if (when === 'post') {
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } }));
    } else {
      process.stdout.write(`${text}\n`);
    }
  } catch {
    // office unreachable: say nothing
  }
}

async function chatCommand(rest, flags) {
  const [sub, ...words] = rest;
  if (sub === 'nudge') return nudge('chat', String(flags.hook || 'prompt'));
  if (sub === 'post') {
    const text = words.join(' ').trim();
    if (!text) throw new Error('usage: plexi chat post <message> [--vibe friendly|joke|thanks|snipe]');
    await call('POST', '/chat', { text, ...(flags.vibe && { vibe: String(flags.vibe) }) });
    console.log('💬 Posted.');
    return;
  }
  if (sub === 'read' || !sub) {
    const { messages, unread } = await call('GET', `/chat?limit=${Number(flags.limit) || 30}`);
    console.log(unread ? `💬 ${unread} new message(s):` : '💬 Nothing new. Latest:');
    console.log(messages.length ? messages.map(chatLine).join('\n') : '(the chat is quiet)');
    return;
  }
  throw new Error('usage: plexi chat read [--limit N] | plexi chat post <message> [--vibe friendly|joke|thanks|snipe]');
}

async function reportsCommand(rest, flags) {
  if (rest[0] === 'nudge') return nudge('reports', String(flags.hook || 'prompt'));
  const { messages, unread } = await call('GET', `/reports?limit=${Number(flags.limit) || 30}`);
  console.log(unread ? `📝 ${unread} new report(s):` : '📝 No new reports. Latest:');
  console.log(messages.length ? messages.map(chatLine).join('\n') : '(no reports yet)');
}

async function main() {
  const [cmd, ...argv] = process.argv.slice(2);
  const { flags, rest } = parseArgs(argv);
  switch (cmd) {
    case 'whoami': {
      const me = await call('GET', '/whoami');
      const p = me.personality;
      console.log(`${me.name} — ${me.roleLabel} on ${me.team}\n${p.emoji} ${p.title}: ${p.traits.join(', ')}\n"${p.catchphrase}"\ncwd: ${me.cwd}`);
      console.log(`\n${describeCanon(me.canon || {})}\n\n${describeRelationships(me.relationships || [])}`);
      break;
    }
    case 'status':
      printStatus(await call('GET', `/status?tails=${flags.tails ? 1 : 0}&lines=${Number(flags.lines) || 12}`), Boolean(flags.tails));
      break;
    case 'tail': {
      if (!rest[0]) throw new Error('usage: plexi tail <name> [--lines N]');
      const { name, text } = await call('GET', `/tail?name=${encodeURIComponent(rest.join(' '))}&lines=${Number(flags.lines) || 40}`);
      console.log(`── ${name}'s screen ──\n${text || '(nothing on screen)'}`);
      break;
    }
    case 'assign': {
      const [name, ...words] = rest;
      if (!name || !words.length) throw new Error('usage: plexi assign <name> <task>');
      const done = await call('POST', '/assign', { name, task: words.join(' ') });
      const note = done.state === 'offline' ? ' (they were offline, so they clocked in to start on it)' : '';
      console.log(`📨 Sent to ${done.name}${note}.`);
      break;
    }
    case 'push': {
      const { branch } = await call('POST', '/git/push', { dir: process.cwd() });
      console.log(`⬆️  Pushed ${branch} to GitHub. Open a PR with: plexi pr create --title "..." --body "..."`);
      break;
    }
    case 'fetch':
      await call('POST', '/git/fetch', { dir: process.cwd() });
      console.log('⬇️  Fetched the latest from GitHub.');
      break;
    case 'pr':
      await pr(rest, flags);
      break;
    case 'sanction':
      await sanction(rest, flags);
      break;
    case 'decor':
      await decor(rest, flags);
      break;
    case 'chat':
      await chatCommand(rest, flags);
      break;
    case 'report': {
      const text = rest.join(' ').trim();
      if (!text) throw new Error('usage: plexi report <what you finished, where it is (branch/PR), and anything blocking>');
      const r = await call('POST', '/report', { text });
      console.log(`📝 Reported to ${r.to}.`);
      break;
    }
    case 'reports':
      await reportsCommand(rest, flags);
      break;
    case 'memory':
      await memory(rest, flags);
      break;
    case 'recall':
      await recall(flags);
      break;
    case 'roster': {
      const { teams } = await call('GET', '/roster');
      for (const t of teams) {
        const cli = t.installed ? 'installed ✓' : 'NOT installed (the office installs it when the agent is first opened)';
        console.log(`${t.label}: ${t.count}/${t.capacity} desks — CLI ${t.bin} ${cli}`);
        if (t.members.length) console.log(`  ${t.members.join(', ')}`);
      }
      break;
    }
    case 'personalities': {
      const { personalities } = await call('GET', '/personalities');
      for (const p of personalities) console.log(`${p.key.padEnd(12)} ${p.emoji} ${p.title} — ${p.traits.join(', ')}`);
      break;
    }
    case 'hire': {
      if (!flags.name || !flags.team) throw new Error('usage: plexi hire --name N --team claude|codex|cursor [--cwd DIR] [--personality KEY]');
      const hired = await call('POST', '/hire', {
        name: String(flags.name),
        type: String(flags.team),
        cwd: flags.cwd ? String(flags.cwd) : undefined,
        personality: flags.personality ? String(flags.personality) : undefined,
      });
      console.log(`🎉 Hired ${hired.name} to ${hired.team} — ${hired.personality.emoji} ${hired.personality.title}. They're walking in now.`);
      break;
    }
    default:
      process.stdout.write(HELP);
  }
}

main().catch((err) => {
  if (process.argv[2] === 'recall' || (['chat', 'reports'].includes(process.argv[2]) && process.argv[3] === 'nudge')) process.exit(0);
  console.error(`plexi: ${err.message}`);
  process.exit(1);
});
