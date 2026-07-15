import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
puppeteer.use(StealthPlugin());

async function main() {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36");
  await page.setViewport({ width: 1280, height: 800 });

  // Intercept all requests
  const apiCalls: any[] = [];
  page.on("request", (req) => {
    if (req.url().includes("csite-bff") && req.method() === "POST") {
      apiCalls.push({ url: req.url().substring(0, 200), method: req.method(), postData: req.postData()?.substring(0, 500) });
    }
  });

  page.on("response", async (resp) => {
    const url = resp.url();
    if (url.includes("csite-bff") && resp.status() === 200) {
      try {
        const text = await resp.text();
        if (text.includes("bukkenList") || text.includes("price") || text.includes("address")) {
          console.log("\n=== FOUND LISTING DATA ===");
          console.log("URL:", url.substring(0, 200));
          console.log("SIZE:", text.length);
          console.log("BODY:", text.substring(0, 2000));
        }
      } catch(e) {}
    }
  });

  await page.goto("https://www.athome.co.jp/tochi/tokyo/list/?pref=13&cities=shinjuku&basic=kp299,kp120,kp001,kf001,ke001,kj001&kod=&q=1",
    { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));

  // Try clicking search/filter button to trigger API
  try {
    const btn = await page.$('[class*="search"] button, [class*="Search"], button:has-text("検索")');
    if (btn) {
      await btn.click();
      await new Promise(r => setTimeout(r, 3000));
    }
  } catch(e) {}

  if (apiCalls.length > 0) {
    console.log("\n=== POST API CALLS ===");
    apiCalls.forEach(a => console.log(JSON.stringify(a)));
  }

  // Check what's actually visible on the page
  const visible = await page.evaluate(() => {
    const items = document.querySelectorAll('[class*="bukken"],[class*="property"]');
    const populated = Array.from(items).filter(el => (el.textContent || "").trim().length > 20);
    return {
      totalItems: items.length,
      populatedItems: populated.length,
      sample: populated.slice(0, 2).map(el => el.textContent?.trim().substring(0, 300) || "")
    };
  });

  console.log("\n=== VISIBLE CONTENT ===");
  console.log(JSON.stringify(visible, null, 2));

  await browser.close();
}

main().catch(console.error);
