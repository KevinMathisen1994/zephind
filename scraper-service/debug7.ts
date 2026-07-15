import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
puppeteer.use(StealthPlugin());

async function main() {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36");
  await page.setViewport({ width: 1280, height: 800 });
  
  await page.goto("https://www.athome.co.jp/tochi/tokyo/list/?pref=13&cities=shinjuku&basic=kp299,kp120,kp001,kf001,ke001,kj001&kod=&q=1",
    { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));

  const structure = await page.evaluate(() => {
    // Get the common ancestor that contains both desc and table
    const desc = document.querySelector(".bukken-item__description");
    const table = document.querySelector(".property-detail-table");
    if (!desc || !table) return "MISSING";
    
    // Walk up from desc
    let d = desc.parentElement;
    let depth = 0;
    while (d && depth < 10) {
      if (d.contains(table)) return { 
        found: true, 
        depth, 
        tag: d.tagName, 
        class: (d.className as string)?.substring(0, 100),
        childCount: d.children.length,
        html: d.outerHTML.substring(0, 5000)
      };
      d = d.parentElement;
      depth++;
    }
    return { found: false, depth };
  });

  console.log("Structure:", JSON.stringify(structure, null, 2));

  await browser.close();
}

main().catch(console.error);
