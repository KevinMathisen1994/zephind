import assert from "node:assert/strict";
import { parseGeminiJson } from "./mailIngest";

// Real failure from a sync: the unit glued onto a bare number.
const repaired = parseGeminiJson(
  '{"listings": [{"title": "日本橋小舟町事務所ビル", "address": "中央区日本橋小舟町8番13号", "price": 148000万円, "area": 948.2㎡, "yield": 3.08%, "walkMinutes": 5}]}',
);
assert.deepEqual(repaired.listings[0], {
  title: "日本橋小舟町事務所ビル", address: "中央区日本橋小舟町8番13号", price: 148000, area: 948.2, yield: 3.08, walkMinutes: 5,
});
assert.deepEqual(parseGeminiJson('{"listings": []}'), { listings: [] });
assert.throws(() => parseGeminiJson("not json"));
console.log("mailIngest.test ok");
