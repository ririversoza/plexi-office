// Characters in the office: agents that walk to wherever their state sends
// them, and the manager (you), steered with WASD / arrows or click-to-move.
import { findPath } from './path.js';
import {
  ELEVATOR, ENTRANCE, MANAGER_START, approachTile, canStep, deskSeats, dormBedrolls, dormBeds, isWalkable, nearestWalkable,
  roomSpots, staffSeats, styleFor,
} from './world.js';
import { MANAGER_LOOK, SIT_POSES, makeLook } from './chibi.js';

const WALK_SPEED = 2.6;
const MANAGER_SPEED = 3.6;
const ARRIVE_EPS = 0.04;
const NEAR_MANAGER = 1.8;
const CHATTER_MIN_S = 45;
const CHATTER_RANGE_S = 70;

export const FACING_VIEW = {
  E: { view: 'front', flip: false },
  S: { view: 'front', flip: true },
  N: { view: 'back', flip: false },
  W: { view: 'back', flip: true },
};

const EXPRESSIONS = { working: 'focus', break: 'happy', question: 'surprised', conflict: 'worried', offline: 'sleep' };
const RECENT_QUESTION_MS = 5 * 60_000;
const ELEVATOR_RIDE_S = 1.1;
const ELEVATOR_TILE = { i: ELEVATOR.i, j: ELEVATOR.j };

const nowS = () => performance.now() / 1000;
const ROOM_FOR_STATE = { break: 'break', question: 'manager', conflict: 'conflict' };

function facingFrom(dx, dy, fallback) {
  if (Math.abs(dx) < 1e-4 && Math.abs(dy) < 1e-4) return fallback;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'E' : 'W';
  return dy > 0 ? 'S' : 'N';
}

function tileOf(x, y) {
  return { i: Math.floor(x), j: Math.floor(y) };
}

/** Who sits where. Desks are permanent; room spots are first-come. */
export class SeatBook {
  constructor() {
    this.roomTaken = new Map(); // spot -> agent id
  }

  /** Everyone has their own bed upstairs (bedrolls once the beds run out). */
  bedFor(agent, agentsInOrder) {
    const index = agentsInOrder.findIndex((a) => a.id === agent.id);
    return dormBeds[index] || dormBedrolls[index - dormBeds.length] || dormBedrolls.at(-1);
  }

  deskFor(agent, agentsInOrder) {
    if (agent.role !== 'worker') return staffSeats[agent.role];
    const team = agentsInOrder.filter((a) => a.role === 'worker' && a.type === agent.type);
    return deskSeats[agent.type][team.findIndex((a) => a.id === agent.id)] || null;
  }

  claimRoom(room, id, preferPose) {
    const free = roomSpots[room].filter((s) => !this.roomTaken.has(s) || this.roomTaken.get(s) === id);
    const spot = free.find((s) => s.pose === preferPose) || free[0] || null;
    if (spot) this.roomTaken.set(spot, id);
    return spot;
  }

  release(spot, id) {
    if (spot && this.roomTaken.get(spot) === id) this.roomTaken.delete(spot);
  }
}

/** Tile path on one floor, or elevator → other floor → tile path. Ends at `goal` exactly. */
export function routeBetween(from, fromFloor, goal, goalFloor, goalTile) {
  if (fromFloor === goalFloor) return [...(findPath(from, goalTile, goalFloor) || []), goal];
  return [
    ...(findPath(from, ELEVATOR_TILE, fromFloor) || []),
    { x: ELEVATOR.x, y: ELEVATOR.y, elevator: goalFloor },
    ...(findPath(ELEVATOR_TILE, goalTile, goalFloor) || []).slice(1),
    goal,
  ];
}

class Walker {
  constructor(x, y, floor = 1) {
    this.x = x;
    this.y = y;
    this.floor = floor;
    this.path = [];
    this.facing = 'S';
    this.speed = WALK_SPEED;
    this.ride = null;
  }

  get moving() {
    return this.path.length > 0;
  }

  /** Inside the elevator between floors: not drawn, can't be clicked. */
  get hidden() {
    return Boolean(this.ride);
  }

  step(dt) {
    let budget = this.speed * dt;
    while (budget > 0 && this.path.length) {
      const [next] = this.path;
      const dx = next.x - this.x;
      const dy = next.y - this.y;
      const dist = Math.hypot(dx, dy);
      if (next.elevator && dist < ARRIVE_EPS) {
        if (!this.ride) this.ride = { until: nowS() + ELEVATOR_RIDE_S, to: next.elevator };
        if (nowS() < this.ride.until) return;
        this.floor = this.ride.to;
        this.ride = null;
        this.path.shift();
        continue;
      }
      if (dist < ARRIVE_EPS) {
        this.path.shift();
        continue;
      }
      this.facing = facingFrom(dx, dy, this.facing);
      const move = Math.min(budget, dist);
      this.x += (dx / dist) * move;
      this.y += (dy / dist) * move;
      budget -= move;
    }
  }

  get depth() {
    return this.x + this.y;
  }
}

export class AgentEntity extends Walker {
  constructor(agent, { seat, bed, spawnAtDoor = false }) {
    const asleep = !spawnAtDoor && (agent.status?.state || 'offline') === 'offline' && bed;
    const home = asleep ? bed : seat;
    const start = spawnAtDoor ? ENTRANCE : home || MANAGER_START;
    super(start.x, start.y, spawnAtDoor ? 1 : home?.floor || 1);
    this.id = agent.id;
    this.phase = Math.random() * Math.PI * 2;
    this.seat = seat;
    this.bed = bed;
    this.spot = spawnAtDoor ? null : home;
    this.arrived = !spawnAtDoor;
    this.facing = home?.facing || 'S';
    this.speech = null;
    this.thought = null;
    this.mood = null;
    this.convo = null;
    this.faceTarget = null;
    this.lastQuestionAt = 0;
    this.nextChatter = CHATTER_MIN_S + Math.random() * CHATTER_RANGE_S;
    this.sync(agent);
    if (spawnAtDoor) this.say('Hi everyone! 👋', 4);
  }

  sync(agent) {
    this.agent = agent;
    this.name = agent.name;
    this.style = styleFor(agent);
    this.look = makeLook(agent.look?.seed, { type: agent.type, role: agent.role, badge: this.style.color });
    this.state = agent.status?.state || 'offline';
    this.detail = agent.status?.detail || '';
    this.activity = agent.status?.activity || '';
    if (this.state === 'question') this.lastQuestionAt = Date.now();
  }

  get recentlyAsked() {
    return Date.now() - this.lastQuestionAt < RECENT_QUESTION_MS;
  }

  /** Speech bubble (conversations, greetings). */
  say(text, seconds = 4) {
    this.speech = { text, until: nowS() + seconds };
    this.thought = null;
  }

  /** Thought bubble. */
  think(text, seconds = 3.5) {
    this.thought = { text, until: nowS() + seconds };
  }

  /** Temporary gesture + expression, e.g. a stretch or a laugh. */
  setMood(pose, expression, seconds) {
    this.mood = { pose, expression, until: nowS() + seconds };
  }

  /** Picks where this agent should be for its current state and walks there. */
  retarget(book) {
    const room = ROOM_FOR_STATE[this.state];
    let target = this.state === 'offline' && this.bed ? this.bed : this.seat;
    if (room) {
      target = this.spot?.room === room
        ? this.spot
        : book.claimRoom(room, this.id, room === 'break' ? this.agent.persona?.breakSpot : undefined);
    }
    target = target || this.seat;
    if (!target || target === this.spot) return;
    const leaving = this.spot;
    if (leaving) book.release(leaving, this.id);
    this.spot = target;
    this.arrived = false;
    this.planPath(leaving);
  }

  /** Walks over to stand next to another agent (for a chat). Returns false if there's no room. */
  visit(other, book) {
    const ti = Math.floor(other.x);
    const tj = Math.floor(other.y);
    const options = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]
      .map(([di, dj]) => ({ i: ti + di, j: tj + dj }))
      .filter(({ i, j }) => isWalkable(i, j, this.floor))
      .sort((p, q) => Math.hypot(p.i - this.x, p.j - this.y) - Math.hypot(q.i - this.x, q.j - this.y));
    if (!options.length) return false;
    const { i, j } = options[0];
    const leaving = this.spot;
    book.release(leaving, this.id);
    this.spot = { x: i + 0.5, y: j + 0.5, facing: 'S', pose: 'stand', room: other.spot?.room, floor: this.floor, visit: true };
    this.arrived = false;
    this.planPath(leaving);
    return true;
  }

  /** Leaves a temporary visiting spot and goes back to a proper one for the current state. */
  returnFromVisit(book) {
    if (!this.spot?.visit) return;
    this.spot = null;
    this.retarget(book);
  }

  planPath(leaving) {
    let from = tileOf(this.x, this.y);
    if (!isWalkable(from.i, from.j, this.floor)) {
      from = leaving && (leaving.floor || 1) === this.floor ? approachTile(leaving) : nearestWalkable(this.x, this.y, this.floor);
    }
    this.path = routeBetween(from, this.floor, { x: this.spot.x, y: this.spot.y }, this.spot.floor || 1, approachTile(this.spot));
  }

  update(dt, t, manager) {
    this.step(dt);
    if (!this.moving && this.spot && !this.arrived) {
      this.arrived = true;
      this.facing = this.spot.facing;
    }
    if (!this.moving && this.spot && !this.sitting) {
      this.facing = this.faceTarget
        ? facingFrom(this.faceTarget.x - this.x, this.faceTarget.y - this.y, this.facing)
        : this.spot.facing;
    }
    this.nearManager = Math.hypot(manager.x - this.x, manager.y - this.y) < NEAR_MANAGER;
    this.nextChatter -= dt;
    if (this.nextChatter <= 0) {
      this.nextChatter = CHATTER_MIN_S + Math.random() * CHATTER_RANGE_S;
      const phrase = this.agent.persona?.catchphrase;
      if (phrase && (this.state === 'working' || this.state === 'break')) this.say(phrase, 4.5);
    }
    if (this.speech && this.speech.until < t) this.speech = null;
    if (this.thought && this.thought.until < t) this.thought = null;
    if (this.mood && this.mood.until < t) this.mood = null;
  }

  get sitting() {
    return !this.moving && SIT_POSES.has(this.spot?.pose);
  }

  get lift() {
    return this.moving ? 0 : this.spot?.lift || 0;
  }

  get sitLow() {
    return this.spot?.pose === 'beanbag';
  }

  /** Arm gesture: walking, a temporary mood, or the spot's resting pose. */
  get pose() {
    if (this.moving) return 'walk';
    if (this.state === 'question' && this.nearManager) return 'wave';
    if (this.mood) return this.mood.pose;
    return this.spot?.pose || 'stand';
  }

  get expression() {
    if (this.state === 'question' && this.nearManager) return 'sparkle';
    if (this.mood?.expression && this.state !== 'offline') return this.mood.expression;
    return EXPRESSIONS[this.state] || 'happy';
  }
}

const MANAGER_MOOD_CYCLE_S = 12;

export class Manager extends Walker {
  constructor(name, look) {
    super(MANAGER_START.x, MANAGER_START.y);
    this.name = name || 'You';
    this.look = { ...MANAGER_LOOK, ...(look || {}) };
    this.speed = MANAGER_SPEED;
    this.phase = 0;
    this.input = { x: 0, y: 0 };
  }

  /** Screen-relative input: up = away from the viewer. */
  setInput(up, down, left, right) {
    if (this.ride) return;
    const sx = (right ? 1 : 0) - (left ? 1 : 0);
    const sy = (down ? 1 : 0) - (up ? 1 : 0);
    // screen right = (+x, -y); screen down = (+x, +y)
    const wx = sx + sy;
    const wy = sy - sx;
    const len = Math.hypot(wx, wy);
    this.input = len ? { x: wx / len, y: wy / len } : { x: 0, y: 0 };
    if (len) this.path = [];
  }

  walkTo(x, y, floor = this.floor) {
    const goal = tileOf(x, y);
    if (!isWalkable(goal.i, goal.j, floor) || this.ride) return false;
    this.path = routeBetween(tileOf(this.x, this.y), this.floor, { x, y }, floor, goal).slice(1);
    return this.path.length > 0;
  }

  /** Takes the elevator to the other floor. */
  travelTo(floor) {
    if (floor === this.floor || this.ride) return false;
    return this.walkTo(ELEVATOR.x, ELEVATOR.y + 0.9, floor);
  }

  canMoveTo(nx, ny) {
    const f = this.floor;
    const a = tileOf(this.x, this.y);
    const b = tileOf(nx, ny);
    if (a.i === b.i && a.j === b.j) return true;
    if (!isWalkable(b.i, b.j, f)) return false;
    if (a.i !== b.i && a.j !== b.j) {
      return (canStep(a.i, a.j, b.i, a.j, f) && canStep(b.i, a.j, b.i, b.j, f))
        || (canStep(a.i, a.j, a.i, b.j, f) && canStep(a.i, b.j, b.i, b.j, f));
    }
    return canStep(a.i, a.j, b.i, b.j, f);
  }

  update(dt) {
    const { x: ix, y: iy } = this.input;
    if ((!ix && !iy) || this.ride) {
      this.step(dt);
      return;
    }
    const nx = this.x + ix * this.speed * dt;
    const ny = this.y + iy * this.speed * dt;
    if (this.canMoveTo(nx, ny)) {
      this.x = nx;
      this.y = ny;
    } else if (this.canMoveTo(nx, this.y)) {
      this.x = nx;
    } else if (this.canMoveTo(this.x, ny)) {
      this.y = ny;
    }
    this.facing = facingFrom(ix, iy, this.facing);
  }

  get walking() {
    return Boolean(this.input.x || this.input.y || this.moving);
  }

  setLook(look) {
    this.look = { ...MANAGER_LOOK, ...(look || {}) };
  }

  get pose() {
    return this.walking ? 'walk' : this.look.idlePose || 'stand';
  }

  /** Mostly the chosen idle face, with a smile and a wink now and then. */
  get expression() {
    const beat = (performance.now() / 1000) % MANAGER_MOOD_CYCLE_S;
    if (beat > 10.8) return 'wink';
    if (beat > 8.5) return 'happy';
    return this.look.idleFace || 'happy';
  }
}
