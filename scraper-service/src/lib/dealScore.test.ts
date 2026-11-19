import assert from "node:assert/strict";
import {
  computeDealScore,
  dedupeAndAnnotateListings,
  DEAL_SCORE_WEIGHTS,
} from "./dealScore";

const NOW = new Date("2026-11-18T00:00:00Z").getTime();
const DAY = 24 * 60 * 60 * 1000;

// 1. Missing inputs -> null signal and weight renormalized properly
{
  const res = computeDealScore(
    {
      _id: "l1",
      ward: "港区",
      propertyType: "マンション",
      price: 8000,
      area: 80, // 100万円/㎡
      source: "suumo",
    },
    { now: NOW, mlitBenchmark: 100 },
  );
  // Only signal (a) [value=0.5, weight=30] and signal (e) [value=0.65, weight=10] are active.
  // Signals (b) condo skipped, (c) no rentals, (d) no postedAt/drop, (g) no land/latlng -> all dropped.
  const keys = res.signals.map((s) => s.key);
  assert.deepEqual(keys, ["a", "e"]);
  const expected = Math.round(((0.5 * DEAL_SCORE_WEIGHTS.a + 0.65 * DEAL_SCORE_WEIGHTS.e) / (DEAL_SCORE_WEIGHTS.a + DEAL_SCORE_WEIGHTS.e)) * 100);
  assert.equal(res.score, expected);
}

// 2. A 20%-below-market listing scores strictly above an at-market one
{
  const below = computeDealScore(
    {
      _id: "below",
      ward: "渋谷区",
      propertyType: "マンション",
      price: 8000,
      area: 100, // 80万円/㎡ = -20% vs 100
      source: "suumo",
    },
    { now: NOW, mlitBenchmark: 100 },
  );
  const atMarket = computeDealScore(
    {
      _id: "at",
      ward: "渋谷区",
      propertyType: "マンション",
      price: 10000,
      area: 100, // 100万円/㎡ = 0% vs 100
      source: "suumo",
    },
    { now: NOW, mlitBenchmark: 100 },
  );
  assert.ok(below.score > atMarket.score, `Expected ${below.score} > ${atMarket.score}`);
  const sigA = below.signals.find((s) => s.key === "a");
  assert.ok(sigA?.reason.includes("-20%"), `Expected -20% in ${sigA?.reason}`);
}

// 3. roadWidth 3 -> red flag, and red flags do NOT alter score
{
  const baseListing = {
    _id: "rw-ok",
    ward: "目黒区",
    propertyType: "一戸建て",
    price: 9000,
    area: 100,
    landSize: 100,
    floorAreaRatio: 200,
    source: "nomu",
    roadWidth: 5,
  };
  const flaggedListing = { ...baseListing, _id: "rw-3", roadWidth: 3 };
  const okRes = computeDealScore(baseListing, { now: NOW, mlitBenchmark: 100 });
  const flaggedRes = computeDealScore(flaggedListing, { now: NOW, mlitBenchmark: 100 });
  assert.equal(okRes.flags.length, 0);
  assert.ok(flaggedRes.flags.some((f) => f.includes("再建築不可の可能性")));
  assert.equal(flaggedRes.score, okRes.score, "Red flag must not change dealScore");
}

// 4. Duplicate across 2 sources -> keep cheapest canonical row and feed price gap into signal (d)
{
  const rows = [
    {
      _id: "dup-expensive",
      source: "suumo",
      address: "東京都港区南麻布５丁目12番3号",
      area: 65.2,
      floor: 3,
      price: 10000,
      ward: "港区",
      propertyType: "マンション",
    },
    {
      _id: "dup-cheap",
      source: "nomu",
      address: "港区南麻布5-12-3",
      area: 65.9, // within ±1㎡
      floor: 3,
      price: 9000, // 10% cheaper across sources
      ward: "港区",
      propertyType: "マンション",
    },
  ];
  const dupMap = dedupeAndAnnotateListings(rows);
  const kept = dupMap.get("dup-cheap");
  const dropped = dupMap.get("dup-expensive");
  assert.equal(kept?.duplicateOf, undefined, "Cheapest duplicate should be kept");
  assert.equal(dropped?.duplicateOf, "dup-cheap", "Expensive duplicate should point to cheapest");
  assert.equal(kept?.group.sources.size, 2);

  const cheapScore = computeDealScore(rows[1], {
    now: NOW,
    mlitBenchmark: 150,
    duplicateByListingId: dupMap,
  });
  const sigD = cheapScore.signals.find((s) => s.key === "d");
  assert.ok(sigD != null, "Cross-source price gap should activate signal (d)");
  assert.ok(sigD!.reason.includes("他社掲載比-10.0%"), `Unexpected reason: ${sigD!.reason}`);
}

// 5. Signal (b) 容積未消化 applies to whole buildings / land, skipped for condo units
{
  const condo = computeDealScore(
    {
      _id: "condo",
      propertyType: "マンション",
      price: 5000,
      area: 50,
      landSize: 500,
      floorAreaRatio: 400,
      source: "suumo",
    },
    { now: NOW },
  );
  assert.equal(condo.signals.some((s) => s.key === "b"), false);

  const wholeBuilding = computeDealScore(
    {
      _id: "bldg",
      propertyType: "一棟マンション",
      price: 30000,
      area: 200,
      landSize: 200,
      floorAreaRatio: 300, // allowed = 600, unused = 400 / 600 = 67%
      source: "email",
      emailFrom: "broker@example.com",
    },
    { now: NOW },
  );
  const sigB = wholeBuilding.signals.find((s) => s.key === "b");
  assert.ok(sigB != null);
  assert.ok(sigB!.reason.includes("容積未消化 67%"), `Unexpected reason: ${sigB!.reason}`);
}

// 6. 旧耐震 (pre-1981-06) & keyword flags
{
  const old1979 = computeDealScore({ _id: "old1", buildYear: 1979, title: "借地権付き売地" }, { now: NOW });
  assert.ok(old1979.flags.some((f) => f.includes("旧耐震")));
  assert.ok(old1979.flags.includes("借地権"));

  const old1981Apr = computeDealScore(
    { _id: "old2", buildYear: 1981, specs: { 築年月: "1981年4月" } },
    { now: NOW },
  );
  assert.ok(old1981Apr.flags.some((f) => f.includes("旧耐震")));

  const new1981Jul = computeDealScore(
    { _id: "new1", buildYear: 1981, specs: { 築年月: "1981年7月" } },
    { now: NOW },
  );
  assert.equal(new1981Jul.flags.some((f) => f.includes("旧耐震")), false);
}

// 7. Signal (c) 実質利回り with n >= 5 rental comps and inflated stated yield warning
{
  const rentListings = Array.from({ length: 5 }, (_, i) => ({
    _id: `r-${i}`,
    dealType: "rent",
    ward: "新宿区",
    station: "新宿",
    area: 50,
    rent: 20, // 0.4 万円/㎡/month => 4.8 万円/㎡/year => 240万円/year on 50㎡
  }));
  const res = computeDealScore(
    {
      _id: "sale-1",
      ward: "新宿区",
      station: "新宿",
      propertyType: "マンション",
      price: 6000, // real yield = 240 / 6000 = 4.0%
      area: 50,
      yield: 7.5, // inflated stated yield vs 4.0% real
      postedAt: NOW - 120 * DAY,
      lastSeenAt: NOW,
      source: "rakuten",
    },
    { now: NOW, rentListings },
  );
  const sigC = res.signals.find((s) => s.key === "c");
  assert.ok(sigC != null);
  assert.ok(sigC!.reason.includes("4.0%"));
  assert.ok(res.flags.some((f) => f.includes("想定利回り過大の可能性")));
}

console.log("All dealScore unit tests passed (7/7 assertions suites).");
