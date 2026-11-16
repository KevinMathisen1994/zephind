import assert from "node:assert";
// listingSpecs imports the db client, which refuses to load without these; nothing here touches the db.
process.env.SUPABASE_URL ??= "http://localhost";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test";
const { deriveFields, parseOgImage } = await import("../scraper-service/src/lib/listingSpecs.ts");

const d = deriveFields({ "建ぺい率/容積率": "60%/200%", "表面利回り": "5.2%", "築年月": "2005年3月", "構造": "RC造" });
assert.strictEqual(d.buildingCoverageRatio, 60);
assert.strictEqual(d.floorAreaRatio, 200);
assert.strictEqual(d.yield, 5.2);
assert.strictEqual(d.buildYear, 2005);
const split = deriveFields({ "建蔽率": "80％", "容積率": "400％" });
assert.strictEqual(split.buildingCoverageRatio, 80);
assert.strictEqual(split.floorAreaRatio, 400);

const page = "https://example.jp/buy/123/";
assert.strictEqual(parseOgImage('<meta property="og:image" content="/img/p/123.jpg">', page), "https://example.jp/img/p/123.jpg");
assert.strictEqual(parseOgImage('<meta content="https://x.jp/a.jpg?w=1&amp;h=2" property="og:image">', page), "https://x.jp/a.jpg?w=1&h=2");
assert.strictEqual(parseOgImage('<meta property="og:image" content="/common/img/logo.png">', page), undefined);
assert.strictEqual(parseOgImage("<html></html>", page), undefined);
console.log("listingSpecs tests passed");
