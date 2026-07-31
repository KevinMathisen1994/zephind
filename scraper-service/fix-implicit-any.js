const fs = require('fs');
const path = require('path');
const dir = '/Users/kevinkarlsson/Desktop/Documents/Zephind/scraper-service/src/services';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts'));

for (const file of files) {
  const fp = path.join(dir, file);
  let content = fs.readFileSync(fp, 'utf8');
  let newContent = content.replace(/var results = \[\];/g, 'var results: any[] = [];');
  if (content !== newContent) {
    fs.writeFileSync(fp, newContent);
    console.log('Fixed', file);
  }
}
