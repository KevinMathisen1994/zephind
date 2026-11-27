import assert from "node:assert/strict";
import { dueInSweep, sweepSlot } from "./autoScrape";

// JST = UTC+9: 03:30 JST is 18:30 UTC the day before.
assert.equal(sweepSlot(Date.UTC(2026, 10, 27, 18, 30)), 0);
assert.equal(sweepSlot(Date.UTC(2026, 10, 27, 19, 45)), 0); // started 75 min late
assert.equal(sweepSlot(Date.UTC(2026, 10, 28, 2, 30)), 1);
assert.equal(sweepSlot(Date.UTC(2026, 10, 28, 10, 30)), 2);

assert.deepEqual([0, 1, 2].map((s) => dueInSweep(undefined, s as 0 | 1 | 2)), [true, true, true]);
assert.deepEqual([0, 1, 2].map((s) => dueInSweep("3", s as 0 | 1 | 2)), [true, true, true]);
assert.deepEqual([0, 1, 2].map((s) => dueInSweep("2", s as 0 | 1 | 2)), [true, false, true]);
assert.deepEqual([0, 1, 2].map((s) => dueInSweep("1", s as 0 | 1 | 2)), [true, false, false]);
assert.deepEqual([0, 1, 2].map((s) => dueInSweep("off", s as 0 | 1 | 2)), [false, false, false]);
console.log("ok");
