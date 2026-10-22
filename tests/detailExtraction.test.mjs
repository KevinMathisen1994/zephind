import assert from "node:assert";
import {
  parseFloor,
  parseElevators,
  parseStructure,
  parseTotalUnits,
  parseRoadWidth,
  parseFrontage,
  parseBuildYear,
  parseBcrFar,
  extractDetailsFromHits,
} from "../scraper-service/src/services/propertyDetail.ts";

console.log("Running detail page extraction tests...\n");

// 1. Floor parsing
assert.strictEqual(parseFloor("3階"), 3, "3階 should parse as 3");
assert.strictEqual(parseFloor("10階部分"), 10, "10階部分 should parse as 10");
assert.strictEqual(parseFloor("3階/14階建"), 3, "3階/14階建 should parse as 3");
assert.strictEqual(parseFloor("所在階: 5階"), 5, "所在階: 5階 should parse as 5");
assert.strictEqual(parseFloor("B1階"), -1, "B1階 should parse as -1");
assert.strictEqual(parseFloor("地下2階"), -2, "地下2階 should parse as -2");
assert.strictEqual(parseFloor("7F"), 7, "7F should parse as 7");
assert.strictEqual(parseFloor(""), undefined, "empty floor should return undefined");
console.log("✓ Floor parsing tests passed");

// 2. Elevators parsing
assert.strictEqual(parseElevators("エレベーター有"), 1, "エレベーター有 should be 1");
assert.strictEqual(parseElevators("エレベーター2基"), 2, "エレベーター2基 should be 2");
assert.strictEqual(parseElevators("EV 3基"), 3, "EV 3基 should be 3");
assert.strictEqual(parseElevators("エレベーターなし"), 0, "エレベーターなし should be 0");
assert.strictEqual(parseElevators("EV無"), 0, "EV無 should be 0");
assert.strictEqual(parseElevators("オートロック、宅配ボックス、EV完備"), 1, "EV完備 should be 1");
console.log("✓ Elevators parsing tests passed");

// 3. Structure parsing
assert.deepStrictEqual(parseStructure("鉄骨鉄筋コンクリート造"), { structure: "鉄骨鉄筋コンクリート造", structureType: "SRC" });
assert.deepStrictEqual(parseStructure("RC造"), { structure: "鉄筋コンクリート造", structureType: "RC" });
assert.deepStrictEqual(parseStructure("鉄筋コンクリート"), { structure: "鉄筋コンクリート造", structureType: "RC" });
assert.deepStrictEqual(parseStructure("木造2階建"), { structure: "木造", structureType: "木造" });
assert.deepStrictEqual(parseStructure("軽量鉄骨造"), { structure: "軽量鉄骨造", structureType: "軽量鉄骨" });
assert.deepStrictEqual(parseStructure("鉄骨造"), { structure: "鉄骨造", structureType: "S" });
console.log("✓ Structure parsing tests passed");

// 4. Total units parsing
assert.strictEqual(parseTotalUnits("54戸"), 54, "54戸 should be 54");
assert.strictEqual(parseTotalUnits("総戸数 120戸"), 120, "総戸数 120戸 should be 120");
assert.strictEqual(parseTotalUnits("全戸数: 15戸"), 15, "全戸数: 15戸 should be 15");
console.log("✓ Total units parsing tests passed");

// 5. Road width & frontage parsing
assert.strictEqual(parseRoadWidth("幅員 6.0m"), 6.0, "幅員 6.0m should be 6.0");
assert.strictEqual(parseRoadWidth("公道 北 8m"), 8.0, "公道 北 8m should be 8.0");
assert.strictEqual(parseRoadWidth("前面道路4.5m公道"), 4.5, "前面道路4.5m公道 should be 4.5");
assert.strictEqual(parseFrontage("間口 8.5m"), 8.5, "間口 8.5m should be 8.5");
assert.strictEqual(parseFrontage("接面 12.0m"), 12.0, "接面 12.0m should be 12.0");
console.log("✓ Road width & frontage parsing tests passed");

// 6. Build year parsing
assert.strictEqual(parseBuildYear("2018年3月"), 2018, "2018年 should be 2018");
assert.strictEqual(parseBuildYear("令和2年5月"), 2020, "令和2年 should be 2020");
assert.strictEqual(parseBuildYear("平成15年10月"), 2003, "平成15年 should be 2003");
assert.strictEqual(parseBuildYear("昭和58年"), 1983, "昭和58年 should be 1983");
assert.strictEqual(parseBuildYear("新築"), new Date().getFullYear(), "新築 should be current year");
console.log("✓ Build year parsing tests passed");

// 7. BCR / FAR parsing
assert.deepStrictEqual(parseBcrFar("60% / 200%"), { bcr: 60, far: 200 });
assert.deepStrictEqual(parseBcrFar("建ぺい率80% 容積率300%"), { bcr: 80, far: 300 });
console.log("✓ BCR / FAR parsing tests passed");

// 8. Integration: extractDetailsFromHits
const sampleHits = [
  { label: "所在階", inline: "4階", sibling: "", parent: "4階/10階建" },
  { label: "エレベーター", inline: "有 (2基)", sibling: "", parent: "" },
  { label: "建物構造", inline: "RC造", sibling: "", parent: "" },
  { label: "総戸数", inline: "48戸", sibling: "", parent: "" },
  { label: "前面道路", inline: "公道 北側 6.0m", sibling: "", parent: "" },
  { label: "間口", inline: "7.5m", sibling: "", parent: "" },
  { label: "築年月", inline: "2019年11月", sibling: "", parent: "" },
  { label: "建ぺい率・容積率", inline: "60% / 200%", sibling: "", parent: "" },
  { label: "掲載日", inline: "2026/03/15", sibling: "", parent: "" },
];

const extracted = extractDetailsFromHits(sampleHits, new Date("2026-03-20T00:00:00Z"));
assert.strictEqual(extracted.floor, 4);
assert.strictEqual(extracted.elevators, 2);
assert.strictEqual(extracted.structure, "鉄筋コンクリート造");
assert.strictEqual(extracted.structureType, "RC");
assert.strictEqual(extracted.totalUnits, 48);
assert.strictEqual(extracted.roadWidth, 6.0);
assert.strictEqual(extracted.frontage, 7.5);
assert.strictEqual(extracted.buildYear, 2019);
assert.strictEqual(extracted.buildingCoverageRatio, 60);
assert.strictEqual(extracted.floorAreaRatio, 200);
assert.strictEqual(extracted.postedDateKind, "posted");
assert.ok(extracted.postedAt > 0);
console.log("✓ extractDetailsFromHits tests passed");

console.log("\nAll 8 detail extraction test suites passed successfully!");
