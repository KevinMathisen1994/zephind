/**
 * Dev-only selector inspector. Loads a listing page and dumps the structural
 * facts needed to repair a scraper: where it redirected, how many candidate
 * containers exist, and what the anchors/price/address text actually look like.
 *
 * The browser-side body must be a STRING passed to `new Function` — a normal
 * closure gets esbuild helpers (__name) injected by tsx, which don't exist in
 * the page context and throw "__name is not defined". The scrapers do the same.
 *
 * Usage: npx tsx inspect.ts "<url>" [containerSelector]
 */
import puppeteer from "puppeteer";

const url = process.argv[2];
const containerSel = process.argv[3] || "";

const BODY = `
  var txt = function(e) { return ((e && e.textContent) || "").replace(/\\s+/g, " ").trim(); };

  var hrefCounts = {};
  var anchors = Array.prototype.slice.call(document.querySelectorAll("a[href]"));
  for (var i = 0; i < anchors.length; i++) {
    var h = anchors[i].getAttribute("href") || "";
    var key = h.replace(/\\d+/g, "N").split("?")[0].slice(0, 60);
    hrefCounts[key] = (hrefCounts[key] || 0) + 1;
  }
  var topHrefs = Object.keys(hrefCounts).filter(function(k){return k.length>3;})
    .map(function(k){return [k, hrefCounts[k]];})
    .sort(function(a,b){return b[1]-a[1];}).slice(0, 14);

  var classCounts = {};
  var withClass = Array.prototype.slice.call(document.querySelectorAll("[class]"));
  for (var j = 0; j < withClass.length; j++) {
    var cl = withClass[j].classList;
    for (var k = 0; k < cl.length; k++) {
      var c = cl[k];
      if (/item|card|list|bukken|property|prop|result|estate|panel|box|unit|cassette/i.test(c)) {
        classCounts[c] = (classCounts[c] || 0) + 1;
      }
    }
  }
  var topClasses = Object.keys(classCounts).map(function(k){return [k, classCounts[k]];})
    .filter(function(p){return p[1] >= 2;})
    .sort(function(a,b){return b[1]-a[1];}).slice(0, 18);

  var all = Array.prototype.slice.call(document.querySelectorAll("*"));
  var priceHits = all.filter(function(e){
    return e.children.length === 0 && /[\\d,]+\\s*万円|億/.test(e.textContent || "");
  }).slice(0, 8).map(function(e){
    return { tag: e.tagName.toLowerCase(), cls: String(e.className || "").slice(0,45), text: txt(e).slice(0,40) };
  });

  var containerInfo = null;
  if (cSel) {
    var nodes = Array.prototype.slice.call(document.querySelectorAll(cSel));
    containerInfo = {
      selector: cSel,
      count: nodes.length,
      firstHtml: nodes[0] ? nodes[0].outerHTML.slice(0, 2500) : null,
      innerAnchors: nodes[0] ? Array.prototype.slice.call(nodes[0].querySelectorAll("a[href]")).slice(0,6).map(function(a){
        return { href: a.getAttribute("href").slice(0,90), cls: String(a.className||"").slice(0,40), text: txt(a).slice(0,35) };
      }) : []
    };
  }

  return {
    title: document.title,
    bodyLen: document.body.innerHTML.length,
    h1: txt(document.querySelector("h1")).slice(0, 90),
    topHrefs: topHrefs, topClasses: topClasses, priceHits: priceHits,
    containerInfo: containerInfo,
    dlCount: document.querySelectorAll("dl").length,
    tableCount: document.querySelectorAll("table").length
  };
`;

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );
    await page.setViewport({ width: 1280, height: 900 });

    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await new Promise((r) => setTimeout(r, 3000));

    const out: any = await page.evaluate(new Function("cSel", BODY) as any, containerSel);

    console.log("=== STATUS:", resp?.status(), "FINAL URL:", page.url());
    console.log("=== TITLE:", out.title, "| bodyLen:", out.bodyLen);
    console.log("=== h1:", out.h1, "| dl:", out.dlCount, "table:", out.tableCount);
    console.log("\n=== TOP HREF SHAPES ===");
    for (const [k, n] of out.topHrefs) console.log(`  ${String(n).padStart(4)}  ${k}`);
    console.log("\n=== REPEATED CANDIDATE CLASSES ===");
    for (const [k, n] of out.topClasses) console.log(`  ${String(n).padStart(4)}  .${k}`);
    console.log("\n=== PRICE-LIKE LEAF NODES ===");
    for (const p of out.priceHits) console.log(`  <${p.tag} class="${p.cls}"> ${p.text}`);
    if (out.containerInfo) {
      console.log(`\n=== CONTAINER "${out.containerInfo.selector}" count=${out.containerInfo.count} ===`);
      console.log("--- inner anchors ---");
      for (const a of out.containerInfo.innerAnchors) console.log(`  [${a.cls}] ${a.href}  "${a.text}"`);
      console.log("--- first outerHTML ---");
      console.log(out.containerInfo.firstHtml);
    }
  } finally {
    await browser.close();
  }
})();
