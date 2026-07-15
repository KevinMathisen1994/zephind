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
    // Find the common parent of description and table
    const descs = document.querySelectorAll(".bukken-item__description");
    if (descs.length === 0) return "NO DESCS";
    
    const firstDesc = descs[0];
    const parent = firstDesc.closest('[class*="bukken"],[class*="item"]') || firstDesc.parentElement;
    
    return {
      parentTag: parent?.tagName || "",
      parentClass: (parent?.className as string) || "",
      parentOuterHTML: parent?.outerHTML?.substring(0, 4000) || ""
    };
  });

  console.log("Parent tag:", structure.parentTag);
  console.log("Parent class:", structure.parentClass);
  console.log("\n=== PARENT HTML ===");
  console.log(structure.parentOuterHTML);

  await browser.close();
}

main().catch(console.error);
