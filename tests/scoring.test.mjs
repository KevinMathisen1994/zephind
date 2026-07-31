import { computeMatchScore, normalizeWard } from "../convex/lib/scoring.js";

const CY = 2026; // pin "current year" so build-age tests are stable

const cases = [
  {
    name: "1. Perfect match on every stated criterion + 25% below market comps",
    why: "hits ward/price/type/yield/walk/road, and is a genuine bargain vs MLIT → low 90s",
    expect: [88, 97],
    listing: { ward: "港区", address: "東京都港区赤坂", price: 9000, propertyType: "マンション",
      yield: 7.2, walkMinutes: 4, roadWidth: 8, area: 65, structure: "RC", buildYear: 2020,
      floor: 5, elevators: 2, totalUnits: 60 },
    criteria: { wards: ["港区"], priceMax: 10000, propertyTypes: ["マンション"], minYield: 6,
      walkMinutesMax: 8, minRoadWidth: 6, structureTypes: ["RC"], maxBuildAge: 15 },
    ctx: { marketAvgPrice: 12000, amenityCount: 45, currentYear: CY },
  },
  {
    name: "2. Right ward but 30% over budget and yield unreported",
    why: "location OK, but a 25%+ overshoot caps it and yield is unverifiable → 40s",
    expect: [35, 52],
    listing: { ward: "世田谷区", price: 13000, propertyType: "一戸建て", walkMinutes: 12 },
    criteria: { wards: ["世田谷区"], priceMax: 10000, propertyTypes: ["一戸建て"], minYield: 6 },
    ctx: { marketAvgPrice: 11000, amenityCount: 15, currentYear: CY },
  },
  {
    name: "3. Wrong ward entirely",
    why: "buyer defined an area and this is outside it — hard disqualifier, nothing compensates",
    expect: [5, 20],
    listing: { ward: "足立区", price: 3000, propertyType: "マンション", yield: 9.5,
      walkMinutes: 2, roadWidth: 8 },
    criteria: { wards: ["港区", "千代田区"], priceMax: 10000, propertyTypes: ["マンション"] },
    ctx: { marketAvgPrice: 9000, amenityCount: 50, currentYear: CY },
  },
  {
    name: "4. Meets every stated criterion but priced 35% ABOVE ward comps",
    why: "buyer's boxes all ticked, yet objectively overpriced vs real transactions → 60s-70s, clearly below case 1",
    expect: [58, 78],
    listing: { ward: "新宿区", price: 9800, propertyType: "マンション", yield: 5.0,
      walkMinutes: 9, roadWidth: 5, area: 55, structure: "RC", buildYear: 2012 },
    criteria: { wards: ["新宿区"], priceMax: 10000, propertyTypes: ["マンション"], minYield: 4.5,
      walkMinutesMax: 10, structureTypes: ["RC"], maxBuildAge: 20 },
    ctx: { marketAvgPrice: 7250, amenityCount: 30, currentYear: CY },
  },
  {
    name: "5. Road width required, listing doesn't report it (everything else good)",
    why: "unverifiable hard requirement → mid-70s/low-80s, capped out of the top band, flagged for verification",
    expect: [66, 84],
    listing: { ward: "江東区", price: 6000, propertyType: "土地", area: 120, walkMinutes: 6 },
    criteria: { wards: ["江東区"], priceMax: 7000, propertyTypes: ["土地"], minRoadWidth: 6,
      landSizeMax: 150 },
    ctx: { marketAvgPrice: 6800, amenityCount: 20, currentYear: CY },
  },
  {
    name: "6. Road width reported and FAILS the buyer's minimum",
    why: "same listing as #5 but the requirement is confirmed violated → hard cap ~32, must score well below #5",
    expect: [5, 35],
    listing: { ward: "江東区", price: 6000, propertyType: "土地", area: 120, walkMinutes: 6, roadWidth: 2.5 },
    criteria: { wards: ["江東区"], priceMax: 7000, propertyTypes: ["土地"], minRoadWidth: 6,
      landSizeMax: 150 },
    ctx: { marketAvgPrice: 6800, amenityCount: 20, currentYear: CY },
  },
  {
    name: "7. Wrong property type (buyer wants マンション, listing is 土地)",
    why: "type mismatch is a disqualifier → capped under 30 even though price/area fit",
    expect: [5, 32],
    listing: { ward: "港区", price: 8000, propertyType: "土地", area: 90, walkMinutes: 5 },
    criteria: { wards: ["港区"], priceMax: 10000, propertyTypes: ["マンション"], minElevators: 1 },
    ctx: { marketAvgPrice: 11000, amenityCount: 40, currentYear: CY },
  },
  {
    name: "8. Sparse listing, buyer specified almost nothing",
    why: "meets the one stated criterion at market price, but walk/road/build/yield all unknown — plausible-but-unproven, mid-scale, must sit clearly below case 1",
    expect: [50, 75],
    listing: { ward: "板橋区", price: 4000, propertyType: "土地", area: 85 },
    criteria: { wards: ["板橋区"] },
    ctx: { marketAvgPrice: 4200, amenityCount: null, currentYear: CY },
  },
];

let pass = 0, fail = 0;
for (const c of cases) {
  const r = computeMatchScore(c.listing, c.criteria, c.ctx);
  const ok = r.score >= c.expect[0] && r.score <= c.expect[1];
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  score=${String(r.score).padStart(2)}  expected ${c.expect[0]}-${c.expect[1]}`);
  console.log(`      ${c.name}`);
  console.log(`      reasoning: ${c.why}`);
  console.log(`      fit=${r.fitPct?.toFixed(3) ?? "n/a"} market=${r.marketPct?.toFixed(3) ?? "n/a"}`);
  if (r.disqualifiers.length) console.log(`      DISQUALIFIERS: ${r.disqualifiers.map((d) => `${d.reason} (cap ${d.cap})`).join("; ")}`);
  if (r.unverified.length) console.log(`      UNVERIFIED: ${r.unverified.join("; ")}`);
  console.log();
}

// Structural check the user explicitly called out: same listing, different orders.
const listing = { ward: "港区", price: 8000, propertyType: "マンション", yield: 6, walkMinutes: 5, roadWidth: 6, area: 70, structure: "RC", buildYear: 2015 };
const orders = {
  "港区 / budget 10000 / wants マンション": { wards: ["港区"], priceMax: 10000, propertyTypes: ["マンション"] },
  "港区 / budget 5000 (tight)": { wards: ["港区"], priceMax: 5000, propertyTypes: ["マンション"] },
  "世田谷区 only": { wards: ["世田谷区"], priceMax: 10000 },
  "港区 / needs 10% yield": { wards: ["港区"], priceMax: 10000, minYield: 10 },
  "港区 / needs 築5年以内": { wards: ["港区"], priceMax: 10000, maxBuildAge: 5 },
};
console.log("=== SAME LISTING vs DIFFERENT ORDERS (must differ) ===");
const seen = [];
for (const [label, crit] of Object.entries(orders)) {
  const s = computeMatchScore(listing, crit, { marketAvgPrice: 9000, amenityCount: 35, currentYear: CY }).score;
  seen.push(s);
  console.log(`  ${String(s).padStart(2)}  ${label}`);
}
console.log(`  distinct values: ${new Set(seen).size}/${seen.length}`);

console.log(`\n=== normalizeWard on the real corrupt values ===`);
for (const v of ["13212", "京都町田市", "東京都港区", "港区", "", null, "13208"])
  console.log(`  ${JSON.stringify(v)} -> ${JSON.stringify(normalizeWard(v))}`);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
