// Depth ordering for the isometric scene. Every drawable has a floor footprint
// (box: x0..x1, y0..y1). Where two drawables overlap on screen, the one whose
// footprint is behind (smaller x or y) is drawn first. A character standing
// inside a footprint (sitting on a couch, lying in a bed) is drawn on top —
// unless that part is an overlay such as a blanket.
import { iso } from './iso.js';

const EPS = 0.05;
const PERSON_R = 0.18;
const STATIC_TOP = 2.6; // height units, for screen bounds
const PERSON_HALF_W = 20;
const PERSON_HEIGHT = 76;

function screenBounds(b, zTop) {
  let l = Infinity;
  let r = -Infinity;
  let t = Infinity;
  let bot = -Infinity;
  for (const x of [b.x0, b.x1]) {
    for (const y of [b.y0, b.y1]) {
      for (const z of [0, zTop]) {
        const [sx, sy] = iso(x, y, z);
        l = Math.min(l, sx);
        r = Math.max(r, sx);
        t = Math.min(t, sy);
        bot = Math.max(bot, sy);
      }
    }
  }
  return { l, r, t, b: bot };
}

function overlaps(a, b) {
  return a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
}

function area(b) {
  return (b.x1 - b.x0) * (b.y1 - b.y0);
}

/** Sorting node for a character (anything with x, y, depth and optional lift). */
export function personNode(p) {
  const [sx, sy] = iso(p.x, p.y, 0);
  const lift = p.lift || 0;
  return {
    person: p,
    key: p.depth + 0.001,
    box: { x0: p.x - PERSON_R, x1: p.x + PERSON_R, y0: p.y - PERSON_R, y1: p.y + PERSON_R },
    screen: { l: sx - PERSON_HALF_W, r: sx + PERSON_HALF_W, t: sy - PERSON_HEIGHT - lift, b: sy + 6 },
  };
}

/** True if `a` must be drawn before `b`. */
export function drawsBefore(a, b) {
  const aBehind = a.box.x1 <= b.box.x0 + EPS || a.box.y1 <= b.box.y0 + EPS;
  const bBehind = b.box.x1 <= a.box.x0 + EPS || b.box.y1 <= a.box.y0 + EPS;
  if (aBehind !== bBehind) return aBehind;
  if (aBehind) return a.key < b.key;
  const aPerson = Boolean(a.person);
  if (aPerson !== Boolean(b.person)) {
    const item = aPerson ? b : a;
    const itemFirst = !item.overlay;
    return aPerson ? !itemFirst : itemFirst;
  }
  if (!aPerson) {
    const diff = area(a.box) - area(b.box);
    if (Math.abs(diff) > 1e-6) return diff > 0; // small things sit on big things
  }
  return a.key < b.key;
}

class MinHeap {
  constructor(nodes) {
    this.nodes = nodes;
    this.items = [];
  }

  less(i, j) {
    return this.nodes[this.items[i]].key < this.nodes[this.items[j]].key;
  }

  push(index) {
    const a = this.items;
    a.push(index);
    let c = a.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (!this.less(c, p)) break;
      [a[p], a[c]] = [a[c], a[p]];
      c = p;
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
        if (l < a.length && this.less(l, m)) m = l;
        if (r < a.length && this.less(r, m)) m = r;
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

function addEdge(out, indeg, from, to) {
  out[from].push(to);
  indeg[to]++;
}

export class DepthSorter {
  /** statics: [{ key, box, zTop?, overlay?, ... }] — edges between them are computed once. */
  constructor(statics) {
    this.statics = statics.map((s) => ({ ...s, screen: s.screen || screenBounds(s.box, s.zTop ?? STATIC_TOP) }));
    const n = this.statics.length;
    this.staticOut = Array.from({ length: n }, () => []);
    this.staticIn = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = this.statics[i];
        const b = this.statics[j];
        if (!overlaps(a.screen, b.screen)) continue;
        if (drawsBefore(a, b)) addEdge(this.staticOut, this.staticIn, i, j);
        else addEdge(this.staticOut, this.staticIn, j, i);
      }
    }
  }

  /** Returns statics and people (nodes from personNode) in draw order. */
  sort(people) {
    const nodes = [...this.statics, ...people];
    const n0 = this.statics.length;
    const out = [...this.staticOut.map((list) => list.slice()), ...people.map(() => [])];
    const indeg = [...this.staticIn, ...people.map(() => 0)];
    for (let p = n0; p < nodes.length; p++) {
      for (let q = 0; q < p; q++) {
        if (!overlaps(nodes[p].screen, nodes[q].screen)) continue;
        if (drawsBefore(nodes[q], nodes[p])) addEdge(out, indeg, q, p);
        else addEdge(out, indeg, p, q);
      }
    }
    const heap = new MinHeap(nodes);
    indeg.forEach((d, i) => d === 0 && heap.push(i));
    const order = [];
    const done = new Uint8Array(nodes.length);
    while (heap.size) {
      const i = heap.pop();
      done[i] = 1;
      order.push(nodes[i]);
      for (const j of out[i]) if (--indeg[j] === 0) heap.push(j);
    }
    if (order.length < nodes.length) {
      // A rare cycle: fall back to key order for whatever is left.
      order.push(...nodes.filter((_, i) => !done[i]).sort((a, b) => a.key - b.key));
    }
    return order;
  }
}
