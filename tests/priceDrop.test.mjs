import assert from "node:assert";
import { computeMatchScore } from "../scraper-service/src/lib/scoring.js";

console.log("Running price drop tracking & scoring tests...\n");

const baseListing = {
  ward: "港区",
  address: "東京都港区六本木",
  price: 4500,
  propertyType: "マンション",
  yield: 6.5,
  walkMinutes: 5,
  roadWidth: 6,
  area: 60,
  structure: "RC",
  buildYear: 2018,
};

const criteria = {
  wards: ["港区"],
  priceMax: 5000,
  propertyTypes: ["マンション"],
  minYield: 5.5,
  walkMinutesMax: 8,
};

const ctx = {
  marketAvgPrice: 5500,
  marketAvgPricePerSqm: 90,
  amenityCount: 35,
};

// 1. Base listing without price drop
const resNormal = computeMatchScore(baseListing, criteria, ctx);

// 2. Listing WITH price drop (was 5000万, dropped to 4500万 -> 10% drop)
const droppedListing = {
  ...baseListing,
  previousPrice: 5000,
  initialPrice: 5200,
  priceDropped: true,
  priceDropPct: 10.0,
};
const resDropped = computeMatchScore(droppedListing, criteria, ctx);

// Assert price drop signal was captured in market breakdown
const dropSignal = resDropped.breakdown.market.find((m) => m.key === "priceDrop");
assert.ok(dropSignal, "priceDrop signal should exist in market breakdown");
assert.strictEqual(dropSignal.previousPrice, 5000);
assert.strictEqual(dropSignal.currentPrice, 4500);
assert.strictEqual(dropSignal.dropPct, 10.0);
assert.strictEqual(dropSignal.score, 1.0, "10%+ price drop should receive score 1.0");

// Assert price drop gave a boost to the score
console.log(`Normal listing score: ${resNormal.score} (marketPct: ${resNormal.marketPct.toFixed(3)})`);
console.log(`Price-dropped listing score: ${resDropped.score} (marketPct: ${resDropped.marketPct.toFixed(3)})`);

assert.ok(
  resDropped.marketPct > resNormal.marketPct,
  "Price-dropped listing should have higher marketPct",
);
assert.ok(
  resDropped.score >= resNormal.score,
  "Price-dropped listing score should be >= normal score",
);
console.log("✓ Price drop scoring boost verified");

// 3. Price drop percentage calculation logic
function calculatePriceDrop(prevPrice, newPrice, existingInitial) {
  const isDrop = newPrice < prevPrice;
  const initialPrice = existingInitial ?? prevPrice;
  const dropPct = isDrop ? Math.round(((prevPrice - newPrice) / prevPrice) * 1000) / 10 : null;
  return { isDrop, initialPrice, previousPrice: prevPrice, newPrice, dropPct };
}

const drop1 = calculatePriceDrop(3800, 3500, undefined);
assert.strictEqual(drop1.isDrop, true);
assert.strictEqual(drop1.previousPrice, 3800);
assert.strictEqual(drop1.initialPrice, 3800);
assert.strictEqual(drop1.dropPct, 7.9, "3800万 -> 3500万 is 7.9% drop");

const drop2 = calculatePriceDrop(3500, 3200, 3800);
assert.strictEqual(drop2.isDrop, true);
assert.strictEqual(drop2.previousPrice, 3500);
assert.strictEqual(drop2.initialPrice, 3800, "Should preserve original initial price of 3800");
assert.strictEqual(drop2.dropPct, 8.6, "3500万 -> 3200万 is 8.6% drop from previous");

const increase = calculatePriceDrop(3000, 3200, 3000);
assert.strictEqual(increase.isDrop, false);
assert.strictEqual(increase.dropPct, null);
console.log("✓ Price drop calculation verified");

console.log("\nAll price drop tracking tests passed successfully!");
