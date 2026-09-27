// Office floor plan. Everything is in tile units; (0,0) is the far (top) corner.
export const W = 30;
export const H = 26;

export const TEAMS = {
  claude: { label: 'Team Claude', cli: 'claude', color: '#D97757', light: '#F9E1D6', dark: '#A8553A', icon: '✺' },
  codex: { label: 'Team Codex', cli: 'codex', color: '#12A37F', light: '#D3F1E7', dark: '#0B7A5F', icon: '◎' },
  cursor: { label: 'Team Cursor', cli: 'cursor-agent', color: '#6E6AE8', light: '#E2E0FC', dark: '#4B47B8', icon: '▲' },
};

export const ROLE_STYLE = {
  assistant: { label: 'Assistant Manager', color: '#E9A23B', light: '#FCEBCB', dark: '#B57614', icon: '📋' },
  hr: { label: 'HR', color: '#E86FA0', light: '#FBDDEA', dark: '#B8446F', icon: '💐' },
};

/** Color/icon for an agent: team colors for workers, role colors for staff. */
export function styleFor(agent) {
  return agent.role && agent.role !== 'worker' ? ROLE_STYLE[agent.role] : TEAMS[agent.type] || TEAMS.claude;
}

export const ROOMS = {
  manager: {
    name: "Manager's Office", icon: '★', x0: 0, y0: 0, x1: 9, y1: 8, door: [4, 6],
    floor: ['#D9E4F1', '#CFDBEA'], accent: '#F2B84B',
  },
  conflict: {
    name: 'Merge Conflict Room', icon: '⚔', x0: 9, y0: 0, x1: 19, y1: 8, door: [13, 15],
    floor: ['#F6DADA', '#EFCCCC'], accent: '#E5534B',
  },
  break: {
    name: 'Break Room', icon: '☕', x0: 19, y0: 0, x1: 30, y1: 8, door: [23, 26],
    floor: ['#F2E1C8', '#E9D4B5'], accent: '#E9A23B',
  },
};

export const ZONES = {
  claude: { x0: 1, x1: 9, y0: 10.5, y1: 21.5 },
  codex: { x0: 11, x1: 19, y0: 10.5, y1: 21.5 },
  cursor: { x0: 21, x1: 29, y0: 10.5, y1: 21.5 },
};

const ROOM_FRONT_Y = 8;
const POD_ROWS = [12, 18]; // first desk row of each pod; second row is +1
const DESKS_PER_ROW = 3;

// ── walls (tile edges) ──────────────────────────────────────────────────────
// hWalls: "i,j" blocks crossing between (i, j-1) and (i, j).
// vWalls: "i,j" blocks crossing between (i-1, j) and (i, j).
export const hWalls = new Set();
export const vWalls = new Set();
export const glassSegments = []; // { axis: 'x'|'y', at, from, to } for drawing

function addGlass(axis, at, from, to) {
  glassSegments.push({ axis, at, from, to });
  for (let k = from; k < to; k++) {
    if (axis === 'x') hWalls.add(`${k},${at}`);
    else vWalls.add(`${at},${k}`);
  }
}

(function buildWalls() {
  const doors = Object.values(ROOMS).map((r) => r.door);
  let start = 0;
  for (const [d0, d1] of doors) {
    addGlass('x', ROOM_FRONT_Y, start, d0);
    start = d1;
  }
  addGlass('x', ROOM_FRONT_Y, start, W);
  addGlass('y', ROOMS.conflict.x0, 0, ROOM_FRONT_Y);
  addGlass('y', ROOMS.break.x0, 0, ROOM_FRONT_Y);
})();

// ── furniture ───────────────────────────────────────────────────────────────
// Each item: { kind, x, y, w, d, solid, ...props }. x/y/w/d = footprint.
export const furniture = [];
const add = (item) => { furniture.push({ solid: true, ...item }); return item; };

// Spots are places an agent can stand/sit: { x, y, facing, pose, room }.
export const deskSeats = { claude: [], codex: [], cursor: [] };
export const staffSeats = {};
export const roomSpots = { manager: [], conflict: [], break: [] };

function seat(list, spot) {
  list.push(spot);
  return spot;
}

(function buildPods() {
  for (const [team, zone] of Object.entries(ZONES)) {
    POD_ROWS.forEach((rowY, pod) => {
      const podX = zone.x0 + 1;
      add({ kind: 'divider', x: podX, y: rowY + 0.92, w: DESKS_PER_ROW * 2, d: 0.16, team, solid: false });
      // Row B: agents sit north of the desk and face south (towards you).
      // Row A: agents sit south of the desk and face north (screens visible).
      for (const side of ['B', 'A']) {
        for (let k = 0; k < DESKS_PER_ROW; k++) {
          const dx = podX + k * 2;
          const deskY = side === 'B' ? rowY : rowY + 1;
          const seatSpot = seat(deskSeats[team], {
            x: dx + 1,
            y: side === 'B' ? rowY - 0.36 : rowY + 2.36,
            facing: side === 'B' ? 'S' : 'N',
            pose: 'desk',
            room: 'desk',
            team,
          });
          add({ kind: 'desk', x: dx + 0.08, y: deskY + 0.06, w: 1.84, d: 0.86, team, side, seat: seatSpot, pod, k });
          add({ kind: 'chair', x: seatSpot.x - 0.3, y: seatSpot.y - 0.3, w: 0.6, d: 0.6, seat: seatSpot, solid: false, team });
        }
      }
    });
    add({ kind: 'plant', x: zone.x0 + 0.15, y: 15.2, w: 0.7, d: 0.7, size: 1.1, variant: 0 });
    add({ kind: 'plant', x: zone.x1 - 0.85, y: 21.4, w: 0.7, d: 0.7, size: 0.9, variant: 1 });
  }
  // First hires get the friendly front-facing desks in the front pod.
  for (const team of Object.keys(deskSeats)) {
    deskSeats[team].sort((a, b) => (a.y > 16) - (b.y > 16) || (a.facing === 'N') - (b.facing === 'N') || a.x - b.x);
  }
})();

(function buildOpenFloorDecor() {
  add({ kind: 'waterCooler', x: 9.6, y: 16.1, w: 0.7, d: 0.7 });
  add({ kind: 'printer', x: 19.3, y: 16.0, w: 1.4, d: 0.9 });
  add({ kind: 'plant', x: 9.6, y: 23.6, w: 0.8, d: 0.8, size: 1.3, variant: 2 });
  add({ kind: 'plant', x: 19.6, y: 23.6, w: 0.8, d: 0.8, size: 1.2, variant: 0 });
  add({ kind: 'plant', x: 0.2, y: 8.3, w: 0.7, d: 0.7, size: 1.2, variant: 1 });
  add({ kind: 'plant', x: 29.1, y: 8.3, w: 0.7, d: 0.7, size: 1.2, variant: 2 });
  add({ kind: 'bench', x: 12.5, y: 23.2, w: 5, d: 0.8, color: '#9AB7D3' });
  add({ kind: 'kanban', x: 21.6, y: 23.3, w: 4, d: 0.35 });
  add({ kind: 'lamp', x: 6.6, y: 23.4, w: 0.5, d: 0.5 });

  // HR corner: Poppy faces the room so new hires get a friendly welcome.
  staffSeats.hr = { x: 3, y: 22.64, facing: 'S', pose: 'desk', room: 'desk', role: 'hr' };
  add({ kind: 'desk', x: 2.08, y: 23.06, w: 1.84, d: 0.86, team: 'hr', side: 'B', seat: staffSeats.hr });
  add({ kind: 'chair', x: 2.7, y: 22.34, w: 0.6, d: 0.6, seat: staffSeats.hr, solid: false, color: '#E86FA0' });
  add({ kind: 'sign', x: 1.2, y: 23.2, w: 0.6, d: 0.3, text: 'HR', sub: 'People Ops', color: '#E86FA0' });

  // Memory Vault: the Supermemory server racks. Click to manage memory.
  add({ kind: 'serverRack', x: 26.9, y: 23.1, w: 0.9, d: 0.9, interactive: 'memory' });
  add({ kind: 'serverRack', x: 27.9, y: 23.1, w: 0.9, d: 0.9, interactive: 'memory' });
  add({ kind: 'sign', x: 26.2, y: 23.3, w: 0.6, d: 0.3, text: 'MEMORY', sub: 'Supermemory', color: '#7C6CF0' });
  add({ kind: 'doormat', x: 13.5, y: 24.6, w: 3, d: 1.2, solid: false });
})();

(function buildManagerOffice() {
  add({ kind: 'rug', x: 1.5, y: 1.2, w: 6, d: 5.4, color: '#B8CCE4', solid: false });
  add({ kind: 'managerDesk', x: 2.2, y: 2.1, w: 3.6, d: 1.1 });
  add({ kind: 'bossChair', x: 3.65, y: 1.2, w: 0.7, d: 0.7, solid: false });
  add({ kind: 'bookshelf', x: 6.2, y: 0.08, w: 2.4, d: 0.6 });
  add({ kind: 'plant', x: 0.2, y: 0.2, w: 0.7, d: 0.7, size: 1.4, variant: 0 });
  add({ kind: 'plant', x: 8.1, y: 7.1, w: 0.7, d: 0.7, size: 1, variant: 1 });
  add({ kind: 'bench', x: 0.12, y: 4.2, w: 0.75, d: 3.2, color: '#F2B84B', axis: 'y' });

  // Juniper, the Assistant Manager, sits right next to you.
  staffSeats.assistant = { x: 7.2, y: 3.42, facing: 'N', pose: 'desk', room: 'desk', role: 'assistant' };
  add({ kind: 'desk', x: 6.3, y: 2.12, w: 1.84, d: 0.86, team: 'assistant', side: 'A', seat: staffSeats.assistant });
  add({ kind: 'chair', x: 6.9, y: 3.12, w: 0.6, d: 0.6, seat: staffSeats.assistant, solid: false, color: '#E9A23B' });

  const spots = roomSpots.manager;
  seat(spots, { x: 3.3, y: 3.95, facing: 'N', pose: 'guest', room: 'manager', chair: true });
  seat(spots, { x: 4.7, y: 3.95, facing: 'N', pose: 'guest', room: 'manager', chair: true });
  for (const y of [4.8, 5.8, 6.8]) seat(spots, { x: 0.6, y, facing: 'E', pose: 'bench', room: 'manager' });
  for (const [x, y] of [[2.5, 5.4], [4, 5.6], [5.5, 5.4], [7, 4.6], [7, 6.2], [2.4, 6.9]]) {
    seat(spots, { x, y, facing: 'N', pose: 'raise', room: 'manager' });
  }
  for (const s of spots.filter((sp) => sp.chair)) {
    add({ kind: 'chair', x: s.x - 0.3, y: s.y - 0.3, w: 0.6, d: 0.6, seat: s, solid: false, color: '#E2A93B' });
  }
  ROOMS.manager.center = { x: 4.5, y: 5.2 };
})();

(function buildConflictRoom() {
  add({ kind: 'conferenceTable', x: 11.6, y: 3.3, w: 4.8, d: 1.6 });
  add({ kind: 'alarm', x: 18.2, y: 0.2, w: 0.6, d: 0.6 });
  add({ kind: 'plant', x: 9.2, y: 7.1, w: 0.7, d: 0.7, size: 0.9, variant: 2 });
  add({ kind: 'duck', x: 13.8, y: 3.9, w: 0.3, d: 0.3, solid: false });

  const spots = roomSpots.conflict;
  for (const x of [12.4, 14, 15.6]) seat(spots, { x, y: 2.75, facing: 'S', pose: 'argue', room: 'conflict', chair: true });
  for (const x of [12.4, 14, 15.6]) seat(spots, { x, y: 5.45, facing: 'N', pose: 'argue', room: 'conflict', chair: true });
  for (const x of [11.2, 13.2, 15.4]) seat(spots, { x, y: 1.1, facing: 'N', pose: 'point', room: 'conflict' });
  for (const [x, y] of [[10.6, 4.1], [17.3, 4.1], [11, 6.6], [17, 6.6], [14, 6.8]]) {
    seat(spots, { x, y, facing: x < 14 ? 'E' : 'W', pose: 'pace', room: 'conflict' });
  }
  for (const s of spots.filter((sp) => sp.chair)) {
    add({ kind: 'chair', x: s.x - 0.3, y: s.y - 0.3, w: 0.6, d: 0.6, seat: s, solid: false, color: '#C84B45' });
  }
  ROOMS.conflict.center = { x: 14, y: 6.2 };
})();

(function buildBreakRoom() {
  add({ kind: 'rug', x: 19.6, y: 2.6, w: 3.8, d: 3.4, color: '#E8C99B', solid: false });
  add({ kind: 'counter', x: 19.2, y: 0.08, w: 4.6, d: 0.85 });
  add({ kind: 'fridge', x: 23.9, y: 0.08, w: 1.05, d: 0.85 });
  add({ kind: 'vending', x: 25.1, y: 0.08, w: 1.2, d: 0.85 });
  add({ kind: 'arcade', x: 28.1, y: 0.1, w: 1.1, d: 0.9 });
  add({ kind: 'couch', x: 19.9, y: 3.0, w: 3.2, d: 0.9, color: '#7FB7BE' });
  add({ kind: 'coffeeTable', x: 20.4, y: 5.0, w: 2.2, d: 0.75 });
  add({ kind: 'pingpong', x: 25.0, y: 3.2, w: 3.0, d: 1.5 });
  add({ kind: 'beanbag', x: 20.1, y: 6.3, w: 0.9, d: 0.9, color: '#F4A6A0', solid: false });
  add({ kind: 'beanbag', x: 21.7, y: 6.6, w: 0.9, d: 0.9, color: '#B9A6F4', solid: false });
  add({ kind: 'snackTable', x: 26.2, y: 6.1, w: 0.9, d: 0.9 });
  add({ kind: 'plant', x: 29.1, y: 7.1, w: 0.7, d: 0.7, size: 1.2, variant: 0 });

  const spots = roomSpots.break;
  for (const x of [20.6, 21.5, 22.4]) seat(spots, { x, y: 3.75, facing: 'S', pose: 'couch', room: 'break' });
  seat(spots, { x: 20.55, y: 6.75, facing: 'E', pose: 'beanbag', room: 'break' });
  seat(spots, { x: 22.15, y: 7.05, facing: 'E', pose: 'beanbag', room: 'break' });
  seat(spots, { x: 20.2, y: 1.45, facing: 'N', pose: 'coffee', room: 'break' });
  seat(spots, { x: 28.65, y: 1.5, facing: 'N', pose: 'arcade', room: 'break' });
  seat(spots, { x: 24.5, y: 3.95, facing: 'E', pose: 'pingpong', room: 'break' });
  seat(spots, { x: 28.5, y: 3.95, facing: 'W', pose: 'pingpong', room: 'break' });
  seat(spots, { x: 25.8, y: 6.9, facing: 'E', pose: 'snack', room: 'break' });
  seat(spots, { x: 27.5, y: 6.9, facing: 'W', pose: 'snack', room: 'break' });
  for (const [x, y] of [[24.3, 1.6], [26.9, 1.6], [24, 6], [28.5, 5.8]]) seat(spots, { x, y, facing: 'S', pose: 'sip', room: 'break' });
  ROOMS.break.center = { x: 24.5, y: 5.5 };
})();

// ── 2nd floor: the dorm ─────────────────────────────────────────────────────
// The dorm deck sits directly above part of the office, reached by an elevator
// whose doors line up on both floors. Coordinates share the office's grid.
export const FLOOR2_Z = 4; // height of the 2nd floor deck, in height units
export const DORM = { name: 'Dorms', icon: '🌙', x0: 0, y0: 9, x1: 16, y1: 21 };
export const ELEVATOR = { x: 0.5, y: 9.5, i: 0, j: 9 };
export const dormFurniture = [];
export const dormBeds = [];
export const dormBedrolls = [];

(function buildDorm() {
  const addDorm = (item) => { dormFurniture.push({ solid: true, ...item }); return item; };
  const BED_W = 1.1;
  const BED_D = 1.9;
  const BLANKETS = ['#A5B4FC', '#F9A8D4', '#99F6E4', '#FDE68A', '#C4B5FD', '#FDBA74', '#BAE6FD', '#BBF7D0'];
  [10.3, 14.3, 18.3].forEach((by, row) => {
    for (let k = 0; k < 8; k++) {
      const bx = 1.9 + k * 1.75;
      const spot = { x: bx + BED_W / 2, y: by + 0.55, facing: 'S', pose: 'bed', room: 'dorm', floor: 2, lift: 16 };
      dormBeds.push(spot);
      addDorm({ kind: 'bed', x: bx, y: by, w: BED_W, d: BED_D, spot, blanket: BLANKETS[(k + row * 3) % BLANKETS.length] });
    }
  });
  for (const y of [13.25, 17.25]) {
    for (let k = 0; k < 7; k++) {
      const spot = { x: 2.9 + k * 1.75, y, facing: 'E', pose: 'bed', room: 'dorm', floor: 2, lift: 2 };
      dormBedrolls.push(spot);
      addDorm({ kind: 'bedroll', x: spot.x - 0.45, y: y - 0.3, w: 0.9, d: 0.6, spot, solid: false });
    }
  }
  addDorm({ kind: 'rug', x: 1.5, y: 12.4, w: 14, d: 1.7, color: '#C7D2FE', solid: false });
  addDorm({ kind: 'rug', x: 1.5, y: 16.4, w: 14, d: 1.7, color: '#DDD6FE', solid: false });
  addDorm({ kind: 'plant', x: 15.1, y: 9.2, w: 0.7, d: 0.7, size: 1.1, variant: 1 });
  addDorm({ kind: 'plant', x: 0.2, y: 20.1, w: 0.7, d: 0.7, size: 1, variant: 0 });
  addDorm({ kind: 'bookshelf', x: 12.6, y: 9.08, w: 2.2, d: 0.6 });
  addDorm({ kind: 'lamp', x: 0.3, y: 11.6, w: 0.5, d: 0.5 });
})();

// ── walkability (per floor) ─────────────────────────────────────────────────
function markBlocked(items) {
  const grid = new Uint8Array(W * H);
  for (const f of items) {
    if (!f.solid) continue;
    for (let i = Math.floor(f.x); i < Math.ceil(f.x + f.w); i++) {
      for (let j = Math.floor(f.y); j < Math.ceil(f.y + f.d); j++) {
        const ox = Math.min(f.x + f.w, i + 1) - Math.max(f.x, i);
        const oy = Math.min(f.y + f.d, j + 1) - Math.max(f.y, j);
        if (ox > 0.3 && oy > 0.3 && i >= 0 && j >= 0 && i < W && j < H) grid[j * W + i] = 1;
      }
    }
  }
  return grid;
}

const FLOORS = {
  1: { bounds: { x0: 0, y0: 0, x1: W, y1: H }, blocked: markBlocked(furniture), hWalls, vWalls },
  2: { bounds: DORM, blocked: markBlocked(dormFurniture), hWalls: new Set(), vWalls: new Set() },
};

export function inBounds(i, j, floor = 1) {
  const b = FLOORS[floor].bounds;
  return i >= b.x0 && j >= b.y0 && i < b.x1 && j < b.y1;
}

export function isWalkable(i, j, floor = 1) {
  return inBounds(i, j, floor) && !FLOORS[floor].blocked[j * W + i];
}

/** Can you step from tile (i,j) to the orthogonally adjacent tile (ni,nj)? */
export function canStep(i, j, ni, nj, floor = 1) {
  if (!isWalkable(ni, nj, floor)) return false;
  const f = FLOORS[floor];
  if (ni !== i) return !f.vWalls.has(`${Math.max(i, ni)},${j}`);
  if (nj !== j) return !f.hWalls.has(`${i},${Math.max(j, nj)}`);
  return true;
}

const FACING_STEP = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };

export function nearestWalkable(x, y, floor = 1) {
  const i0 = Math.floor(x);
  const j0 = Math.floor(y);
  for (let r = 0; r < 8; r++) {
    for (let di = -r; di <= r; di++) {
      for (let dj = -r; dj <= r; dj++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        if (isWalkable(i0 + di, j0 + dj, floor)) return { i: i0 + di, j: j0 + dj };
      }
    }
  }
  return { i: ELEVATOR.i, j: ELEVATOR.j };
}

/** The walkable tile an agent walks to before settling into a spot. */
export function approachTile(spot) {
  const floor = spot.floor || 1;
  const i = Math.floor(spot.x);
  const j = Math.floor(spot.y);
  if (isWalkable(i, j, floor)) return { i, j };
  const [fx, fy] = FACING_STEP[spot.facing] || [0, 1];
  const candidates = [[i + fx, j + fy], [i, j + 1], [i + 1, j], [i - 1, j], [i, j - 1]];
  for (const [ci, cj] of candidates) if (isWalkable(ci, cj, floor)) return { i: ci, j: cj };
  return nearestWalkable(spot.x, spot.y, floor);
}

export function roomAt(x, y) {
  for (const [id, r] of Object.entries(ROOMS)) {
    if (x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1) return id;
  }
  return null;
}

export const MANAGER_START = { x: 15.5, y: 9.5 };
/** New hires walk in through the front door. */
export const ENTRANCE = { x: 15, y: 25.4 };
