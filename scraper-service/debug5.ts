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
    // Get all full listing cards 
    const items = document.querySelectorAll(".bukken-item__description");
    const results: any[] = [];
    
    items.forEach((item, idx) => {
      if (idx >= 3) return;
      results.push({
        fullText: item.textContent?.trim() || "",
        html: item.outerHTML
      });
    });

    // Also get all table text for road/frontage search
    const tables = document.querySelectorAll(".property-detail-table");
    const allTableText = Array.from(tables).map(t => t.textContent?.trim() || "").join("\n---\n");

    return { descs: results, allTableText: allTableText.substring(0, 5000) };
  });

  console.log("=== BUKKEN DESCRIPTIONS ===");
  info.descs.forEach((d, i) => {
    console.log(`\n--- Item ${i} ---`);
    console.log(d.fullText.substring(0, 500));
  });

  console.log("\n\n=== ALL TABLE TEXT (searching for road, frontage) ===");
  console.log(info.allTableText);

  await browser.close();
}

main().catch(console.error);
