import { runScraper } from "./src/services/scraperRegistry";
(async () => {
  for (const code of ["13115","13209","13361"]) {
    const r = await runScraper("rakuten", code, ["土地"]);
    const w = [...new Set(r.listings.map(l=>l.ward))].slice(0,4).join(",");
    console.log(`RES rakuten ${code} n=${r.listings.length} wards=[${w}] addr0=${(r.listings[0]||{}).address||"-"}`);
  }
})();
