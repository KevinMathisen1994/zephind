import assert from "node:assert/strict";
import { mergeNearby } from "./mergeBoxes";

// Footer fragments chain into one band; a far header box and another page stay apart.
const r = mergeNearby([
  { pageIndex: 0, x: 0.05, y: 0.86, w: 0.2, h: 0.05 },
  { pageIndex: 0, x: 0.26, y: 0.87, w: 0.4, h: 0.03 },
  { pageIndex: 0, x: 0.67, y: 0.92, w: 0.3, h: 0.04 },
  { pageIndex: 0, x: 0.4, y: 0.02, w: 0.1, h: 0.02 },
  { pageIndex: 1, x: 0.05, y: 0.86, w: 0.2, h: 0.05 },
]);
assert.equal(r.length, 3);
assert.deepEqual(
  { ...r[0], w: +r[0].w.toFixed(3), h: +r[0].h.toFixed(3) },
  { pageIndex: 0, x: 0.05, y: 0.86, w: 0.92, h: 0.1, label: "会社情報" },
);
console.log("ok");
