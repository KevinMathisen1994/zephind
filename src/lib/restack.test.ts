import assert from "node:assert/strict";
import { restack } from "./restack";

const list = [
  { id: "a", pageIndex: 0 },
  { id: "x", pageIndex: 1 },
  { id: "b", pageIndex: 0 },
  { id: "c", pageIndex: 0 },
];
const ids = (l: typeof list) => l.map((a) => a.id).join("");

assert.equal(ids(restack(list, "a", "front")), "xbca");
assert.equal(ids(restack(list, "c", "back")), "caxb");
assert.equal(ids(restack(list, "a", "forward")), "xbac"); // skips the other page's item
assert.equal(ids(restack(list, "b", "backward")), "baxc");
assert.equal(ids(restack(list, "c", "forward")), "axbc"); // already on top
assert.equal(ids(restack(list, "a", "backward")), "axbc"); // already at bottom
assert.equal(restack(list, "missing", "front"), list);
console.log("ok");
