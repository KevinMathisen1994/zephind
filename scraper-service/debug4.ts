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

  const info = await page.evaluate(() => {
    const tables = document.querySelectorAll(".property-detail-table");
    const items: any[] = [];
    
    tables.forEach((table, idx) => {
      if (idx >= 3) return;
      items.push({
        index: idx,
        class: (table.className as string),
        html: table.outerHTML.substring(0, 2000),
        text: table.textContent?.trim()?.substring(0, 500) || ""
      });
    });

    // Also check the bukken-item__description
    const descs = document.querySelectorAll(".bukken-item__description");
    const descItems: any[] = [];
    descs.forEach((d, idx) => {
      if (idx >= 2) return;
      descItems.push({
        html: d.outerHTML.substring(0, 2000),
        text: d.textContent?.trim()?.substring(0, 500) || ""
      });
    });

    return { tableCount: tables.length, tables: items, descCount: descs.length, descs: descItems };
  });

  console.log("Table count:", info.tableCount);
  console.log("Desc count:", info.descCount);
  console.log("\n=== FIRST TABLE HTML ===");
  console.log(info.tables[0]?.html || "NONE");
  console.log("\n=== FIRST DESC HTML ===");
  console.log(info.descs[0]?.html || "NONE");

  await browser.close();
}

main().catch(console.error);
