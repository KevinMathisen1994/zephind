const fs = require('fs');
const path = require('path');
const dir = '/Users/kevinkarlsson/Desktop/Documents/Zephind/scraper-service/src/services';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts') && f !== 'scrapeRoutes.ts' && f !== 'propertyMatcher.ts');

for (const file of files) {
  const fp = path.join(dir, file);
  let content = fs.readFileSync(fp, 'utf8');
  let newContent = content.replace(/const typesToScrape = filterTypes\?\.length \? filterTypes : \["tochi"\];/g, 'const typesToScrape = filterTypes?.length ? filterTypes : ["土地"];');
  
  // Replace CATEGORY_MAP if it matches the standard one
  const catMapRegex = /const CATEGORY_MAP: Record<string, string> = \{\n  tochi: "tochi",\n  kodate: ".*?",\n  mansion: "mansion",\n\};/g;
  
  // Custom replacement function to preserve the kodate value (some use kodate, some use ikkodate)
  newContent = newContent.replace(catMapRegex, (match) => {
    const kodateVal = match.match(/kodate: "(.*?)"/)[1];
    return `const CATEGORY_MAP: Record<string, string> = {\n  "土地": "tochi",\n  "一戸建て": "${kodateVal}",\n  "マンション": "mansion",\n  "収益物件": "mansion",\n};`;
  });

  if (content !== newContent) {
    fs.writeFileSync(fp, newContent);
    console.log('Fixed', file);
  }
}
