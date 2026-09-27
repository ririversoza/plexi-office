// Social life: break-room conversations (speech bubbles), thought bubbles, and
// little idle flourishes (stretching, selfies, facepalms) that make the office feel alive.
import { breakDialog, conflictDialog, thoughtFor } from './dialog.js';

const CHECK_EVERY_S = 3;
const TALK_RADIUS = 4.5;
const LINE_BASE_S = 2.4;
const LINE_PER_CHAR_S = 0.035;
const LINE_GAP_S = 0.3;
const COOLDOWN_MIN_S = 16;
const COOLDOWN_RANGE_S = 22;
const FLOURISH_MIN_S = 6;
const FLOURISH_RANGE_S = 9;
const THOUGHT_S = 3.6;
const LONG_WAIT_MS = 90_000;
const SOCIAL_ROOMS = new Set(['break', 'conflict']);
const WRITER_WAIT_S = 45;
const VISIT_CHANCE = 0.6;
const VISIT_TIMEOUT_S = 20;
const RETURN_CHANCE = 0.5;
const FEELINGS_RADIUS = 3;
const AVOID_WEIGHT = 0.35;

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// [pose, expression, seconds]
const FLOURISHES = {
  working: [['stretch', 'content', 2.2], ['think', 'focus', 2.6], ['nod', 'determined', 2]],
  break: [['peace', 'wink', 2.2], ['stretch', 'content', 2.4], ['nod', 'cat', 2], ['cheer', 'laugh', 1.6]],
  conflict: [['facepalm', 'cry', 2.6], ['crossed', 'pout', 2.6], ['think', 'dizzy', 2.4], ['argue', 'shocked', 2.4], ['cheeks', 'worried', 2.2]],
  question: [['raise', 'surprised', 2.4], ['cheeks', 'pout', 2.4]],
  longWait: [['cheeks', 'sad', 2.8], ['crossed', 'pout', 2.8], ['stretch', 'sleepy', 2.4]],
};

// [pose, expression, seconds, thought]
const ARRIVALS = {
  break: ['stretch', 'content', 2.4, '☕ break time!'],
  manager: ['wave', 'surprised', 2.2, null],
  conflict: ['cheeks', 'shocked', 2.2, '💥 a conflict?!'],
};

export class Social {
  constructor(book) {
    this.book = book;
    this.visits = new Map(); // visitor -> { host, until }
    this.convos = new Set();
    this.nextCheck = 2;
    this.cooldown = new Map();
  }

  update(dt, t, agents, info) {
    this.info = info;
    this.checkVisits(t, info);
    for (const convo of [...this.convos]) this.advance(convo, t);
    this.nextCheck -= dt;
    if (this.nextCheck <= 0) {
      this.nextCheck = CHECK_EVERY_S;
      this.tryStart(t, agents, info);
    }
    for (const a of agents) this.idle(a, dt, t, agents);
  }

  /** How much `a` wants to hang out with `b`: friends and sweethearts attract, enemies repel. */
  weight(a, b) {
    const rel = this.info?.relationship?.(a.id, b.id);
    if (!rel) return 1;
    if (rel.affinity <= -30) return AVOID_WEIGHT;
    return 1 + Math.max(0, rel.affinity) / 30 + (rel.romance || 0) / 25;
  }

  weightedPick(a, candidates) {
    const weights = candidates.map((b) => this.weight(a, b));
    let roll = Math.random() * weights.reduce((sum, w) => sum + w, 0);
    for (let i = 0; i < candidates.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return candidates[i];
    }
    return candidates.at(-1) || null;
  }

  available(a, t) {
    return a.arrived && !a.moving && !a.convo && !this.visits.has(a) && ![...this.visits.values()].some((v) => v.host === a) && SOCIAL_ROOMS.has(a.spot?.room)
      && (a.state === 'break' || a.state === 'conflict') && (this.cooldown.get(a.id) || 0) < t;
  }

  nearestPartner(a, pool, used) {
    const near = pool.filter((b) => b !== a && !used.has(b) && b.spot.room === a.spot.room
      && Math.hypot(a.x - b.x, a.y - b.y) < TALK_RADIUS);
    return near.length ? this.weightedPick(a, near) : null;
  }

  tryStart(t, agents, info) {
    const pool = agents.filter((a) => this.available(a, t)).sort(() => Math.random() - 0.5);
    const used = new Set();
    for (const a of pool) {
      if (used.has(a)) continue;
      const partner = this.nearestPartner(a, pool, used);
      if (partner) {
        used.add(a).add(partner);
        this.start(a, partner, t, info);
        continue;
      }
      // Nobody close by: sometimes wander over to someone across the room.
      const others = pool.filter((b) => b !== a && !used.has(b) && b.spot.room === a.spot.room);
      const host = others.length ? this.weightedPick(a, others) : null;
      if (host && Math.random() < VISIT_CHANCE && a.visit(host, this.book)) {
        used.add(a).add(host);
        this.visits.set(a, { host, until: t + VISIT_TIMEOUT_S });
        a.think(`going to chat with ${host.name}`, 2.5);
      }
    }
  }

  checkVisits(t, info) {
    for (const [visitor, { host, until }] of [...this.visits]) {
      const hostGone = host.moving || !SOCIAL_ROOMS.has(host.spot?.room) || host.convo;
      if (hostGone || t > until || !SOCIAL_ROOMS.has(visitor.spot?.room)) {
        this.visits.delete(visitor);
        visitor.returnFromVisit(this.book);
        continue;
      }
      if (visitor.arrived && !visitor.moving) {
        this.visits.delete(visitor);
        this.start(visitor, host, t, info);
      }
    }
  }

  start(a, b, t, info) {
    const room = a.spot.room;
    const script = () => (room === 'conflict' ? conflictDialog(a, b, info) : breakDialog(a, b, info));
    const convo = { members: [a, b], lines: [], idx: -1, nextAt: t + 0.5, room, pending: false };
    a.convo = convo;
    b.convo = convo;
    a.faceTarget = b;
    b.faceTarget = a;
    this.convos.add(convo);
    if (!info.writeDialogue) {
      convo.lines = script();
      return;
    }
    // A local model writes this one; they think it over while it does.
    convo.pending = true;
    a.think('…', WRITER_WAIT_S);
    b.think('…', WRITER_WAIT_S);
    // Authentic only: if the model can't write this one right now, they simply don't chat.
    info.writeDialogue(a.id, b.id, room)
      .then((written) => {
        convo.lines = written?.lines?.length ? written.lines : [];
        convo.tone = written?.kind;
        convo.ticket = written?.ticket;
      })
      .catch(() => { convo.lines = []; })
      .finally(() => {
        a.thought = null;
        b.thought = null;
        convo.pending = false;
        convo.nextAt = performance.now() / 1000 + 0.2;
      });
  }

  advance(convo, t) {
    const broken = convo.members.some((m) => m.convo !== convo || m.moving || !SOCIAL_ROOMS.has(m.spot?.room));
    if (broken) {
      this.end(convo, t);
      return;
    }
    if (convo.pending || t < convo.nextAt) return;
    convo.idx += 1;
    const line = convo.lines[convo.idx];
    if (!line) {
      this.end(convo, t);
      return;
    }
    const dur = LINE_BASE_S + line.text.length * LINE_PER_CHAR_S;
    const speaker = convo.members[line.who];
    speaker.say(line.text, dur);
    for (const m of convo.members) {
      if (line.together) m.setMood(line.together, 'laugh', dur);
      else if (m === speaker) m.setMood(line.pose || 'chat', line.face || 'grin', dur);
      else m.setMood(line.react?.pose || 'nod', line.react?.face || 'content', dur);
    }
    convo.nextAt = t + dur + LINE_GAP_S;
  }

  /** What kind of interaction a finished conversation was, for the relationship engine. */
  kindOf(convo) {
    if (convo.tone) return convo.tone;
    const highfive = convo.lines.some((l) => l.together === 'highfive' || l.together === 'hug');
    if (convo.room === 'conflict') return highfive ? 'makeup' : 'argue';
    if (highfive) return 'highfive';
    return convo.lines.some((l) => l.face === 'laugh') ? 'joke' : 'chat';
  }

  end(convo, t) {
    this.convos.delete(convo);
    if (convo.lines.length && convo.idx >= convo.lines.length) {
      const [a, b] = convo.members;
      const lines = convo.lines.map((l) => ({ who: l.who, text: l.text }));
      this.info?.report?.(a.id, b.id, this.kindOf(convo), { lines, room: convo.room, ticket: convo.ticket });
    }
    for (const m of convo.members) {
      if (m.convo !== convo) continue;
      m.convo = null;
      m.faceTarget = null;
      this.cooldown.set(m.id, t + COOLDOWN_MIN_S + Math.random() * COOLDOWN_RANGE_S);
      if (m.spot?.visit && Math.random() < RETURN_CHANCE) m.returnFromVisit(this.book);
    }
  }

  /** Arrival reactions, thought bubbles and idle gestures for agents not in a conversation. */
  /** Reacts to a sweetheart or an enemy standing nearby. Returns true if it did. */
  feelings(a, agents) {
    if (!this.info?.relationship || a.state !== 'break') return false;
    for (const b of agents) {
      if (b === a || b.floor !== a.floor || Math.hypot(a.x - b.x, a.y - b.y) > FEELINGS_RADIUS) continue;
      const label = this.info.relationship(a.id, b.id)?.label?.key;
      if (label === 'sweethearts' || label === 'crush') {
        a.setMood('cheeks', 'sparkle', 2.4);
        a.think(`💕 ${b.name}…`, THOUGHT_S);
        return true;
      }
      if (label === 'enemies' || label === 'rivals') {
        a.setMood('crossed', 'pout', 2.4);
        a.think(`ugh, ${b.name} 💢`, THOUGHT_S);
        return true;
      }
    }
    return false;
  }

  idle(a, dt, t, agents = []) {
    if (a.arrived && a.spot && a.greetedSpot !== a.spot) {
      a.greetedSpot = a.spot;
      const arrival = ARRIVALS[a.spot.room];
      if (arrival) {
        const [pose, face, secs, thought] = arrival;
        a.setMood(pose, face, secs);
        if (thought) a.think(thought, THOUGHT_S);
      }
    }
    a.nextFlourish = (a.nextFlourish ?? Math.random() * FLOURISH_RANGE_S) - dt;
    if (a.nextFlourish > 0 || a.convo || a.moving || a.speech || a.state === 'offline') return;
    a.nextFlourish = FLOURISH_MIN_S + Math.random() * FLOURISH_RANGE_S;
    if (Math.random() < 0.35 && this.feelings(a, agents)) return;
    if (Math.random() < 0.5) {
      const thought = thoughtFor(a);
      if (thought) a.think(thought, THOUGHT_S);
      return;
    }
    const waitedLong = a.state === 'question' && Date.now() - (a.agent.status?.since || Date.now()) > LONG_WAIT_MS;
    const options = waitedLong ? FLOURISHES.longWait : FLOURISHES[a.state];
    if (!options) return;
    const [pose, face, secs] = pick(options);
    a.setMood(pose, face, secs);
  }
}
