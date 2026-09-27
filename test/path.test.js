import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPath } from '../public/js/path.js';
import {
  ELEVATOR, ENTRANCE, MANAGER_START, ROOMS, approachTile, canStep, deskSeats, dormBedrolls, dormBeds, isWalkable, roomSpots, staffSeats,
} from '../public/js/world.js';

const start = { i: Math.floor(MANAGER_START.x), j: Math.floor(MANAGER_START.y) };

function allSpots() {
  return [
    ...Object.values(deskSeats).flat(),
    ...Object.values(roomSpots).flat(),
    ...Object.values(staffSeats),
  ];
}

test('every desk seat, room spot and staff desk is reachable from the corridor', () => {
  for (const spot of allSpots()) {
    const path = findPath(start, approachTile(spot));
    assert.ok(path, `unreachable spot ${JSON.stringify(spot)}`);
  }
});

test('new hires can walk from the entrance to every team desk', () => {
  const door = { i: Math.floor(ENTRANCE.x), j: Math.floor(ENTRANCE.y) };
  for (const seat of Object.values(deskSeats).flat()) assert.ok(findPath(door, approachTile(seat)));
});

test('each team has 12 desks and each room has spots', () => {
  for (const seats of Object.values(deskSeats)) assert.equal(seats.length, 12);
  for (const id of Object.keys(ROOMS)) assert.ok(roomSpots[id].length >= 6, id);
});

test('glass walls block crossing except at doors', () => {
  const [d0] = ROOMS.manager.door;
  assert.equal(canStep(1, 8, 1, 7), false, 'wall between corridor and manager office');
  assert.equal(canStep(d0, 8, d0, 7), true, 'manager office door');
  assert.equal(canStep(8, 3, 9, 3), false, 'wall between manager office and conflict room');
});

test('paths never cut through a wall', () => {
  const goal = approachTile(roomSpots.manager[0]);
  const path = findPath(start, goal);
  for (let k = 1; k < path.length; k++) {
    const a = { i: Math.floor(path[k - 1].x), j: Math.floor(path[k - 1].y) };
    const b = { i: Math.floor(path[k].x), j: Math.floor(path[k].y) };
    if (a.i !== b.i && a.j !== b.j) continue; // diagonal validity is checked inside findPath
    assert.ok(canStep(a.i, a.j, b.i, b.j), `step ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
  }
});

test('the elevator is walkable on both floors and every dorm bed is reachable from it', () => {
  assert.ok(isWalkable(ELEVATOR.i, ELEVATOR.j, 1));
  assert.ok(isWalkable(ELEVATOR.i, ELEVATOR.j, 2));
  assert.ok(findPath(start, { i: ELEVATOR.i, j: ELEVATOR.j }, 1), 'office → elevator');
  const lift = { i: ELEVATOR.i, j: ELEVATOR.j };
  for (const bed of [...dormBeds, ...dormBedrolls]) assert.ok(findPath(lift, approachTile(bed), 2), `bed ${JSON.stringify(bed)}`);
  assert.ok(dormBeds.length + dormBedrolls.length >= 38, 'room for every possible agent');
});
