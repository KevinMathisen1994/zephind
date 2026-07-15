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
    // Find the actual listing card elements - elements that contain price (万円) and address info
    const all = document.querySelectorAll('[class*="bukken"],[class*="property"]');
    const populated = Array.from(all).filter(el => (el.textContent || "").trim().length > 100);
    
    // Get the most common class pattern
    const classCounts = new Map<string, number>();
    populated.forEach(el => {
      const cls = (el.className as string) || "";
      if (cls) classCounts.set(cls, (classCounts.get(cls) || 0) + 1);
    });

    return {
      totalPopulated: populated.length,
      commonClasses: Array.from(classCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20),
      firstItemHTML: populated[0]?.outerHTML?.substring(0, 2000) || "NONE",
      firstItemText: populated[0]?.textContent?.trim()?.substring(0, 500) || "NONE"
    };
  });

  console.log("Populated items:", info.totalPopulated);
  console.log("\n=== MOST COMMON CLASSES ON POPULATED ITEMS ===");
  info.commonClasses.forEach(([cls, count]) => console.log(`  "${cls}" x${count}`));
  console.log("\n=== FIRST ITEM HTML (truncated) ===");
  console.log(info.firstItemHTML);
  console.log("\n=== FIRST ITEM TEXT ===");
  console.log(info.firstItemText);

  await browser.close();
}

main().catch(console.error);
