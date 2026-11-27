import assert from "node:assert/strict";
import { wrapLines } from "./wrapText";

const m = (s: string) => s.length * 10;
assert.deepEqual(wrapLines("ZEPHYR", 30, m), ["ZEP", "HYR"]);
assert.deepEqual(wrapLines("ZEPHYR", 100, m), ["ZEPHYR"]);
assert.deepEqual(wrapLines("AB\nCDE", 20, m), ["AB", "CD", "E"]);
assert.deepEqual(wrapLines("湊不動産", 5, m), ["湊", "不", "動", "産"]); // narrower than one char still places one per line
assert.deepEqual(wrapLines("", 30, m), [""]);
console.log("ok");
