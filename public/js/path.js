// A* over the office tile grid, respecting furniture and glass walls.
import { W, canStep, isWalkable, nearestWalkable } from './world.js';

const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

function key(i, j) {
  return j * W + i;
}

/** Diagonals are allowed only when both orthogonal steps are clear (no corner cutting). */
function canMove(i, j, di, dj, floor) {
  if (di === 0 || dj === 0) return canStep(i, j, i + di, j + dj, floor);
  return canStep(i, j, i + di, j, floor) && canStep(i + di, j, i + di, j + dj, floor)
    && canStep(i, j, i, j + dj, floor) && canStep(i, j + dj, i + di, j + dj, floor);
}

/** Minimal binary heap keyed on f-score. */
class Heap {
  constructor() {
    this.items = [];
  }

  push(node) {
    const a = this.items;
    a.push(node);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }

  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }

  get size() {
    return this.items.length;
  }
}

function unwind(came, goal) {
  const out = [];
  let node = goal;
  while (node) {
    out.push({ x: node.i + 0.5, y: node.j + 0.5 });
    node = came.get(key(node.i, node.j));
  }
  return out.reverse();
}

/** Returns tile centres from start to goal (inclusive), or null when unreachable. */
export function findPath(start, goal, floor = 1) {
  const s = isWalkable(start.i, start.j, floor) ? start : nearestWalkable(start.i + 0.5, start.j + 0.5, floor);
  const g = isWalkable(goal.i, goal.j, floor) ? goal : nearestWalkable(goal.i + 0.5, goal.j + 0.5, floor);
  const h = (i, j) => Math.hypot(i - g.i, j - g.j);
  const open = new Heap();
  const came = new Map();
  const cost = new Map([[key(s.i, s.j), 0]]);
  open.push({ i: s.i, j: s.j, f: h(s.i, s.j) });

  while (open.size) {
    const cur = open.pop();
    if (cur.i === g.i && cur.j === g.j) return unwind(came, cur);
    const base = cost.get(key(cur.i, cur.j));
    for (const [di, dj, c] of DIRS) {
      if (!canMove(cur.i, cur.j, di, dj, floor)) continue;
      const ni = cur.i + di;
      const nj = cur.j + dj;
      const nk = key(ni, nj);
      const next = base + c;
      if (next < (cost.get(nk) ?? Infinity)) {
        cost.set(nk, next);
        came.set(nk, { i: cur.i, j: cur.j });
        open.push({ i: ni, j: nj, f: next + h(ni, nj) });
      }
    }
  }
  return null;
}
