import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const yargsDir = path.join(__dirname, 'node_modules', 'yargs');
if (fs.existsSync(yargsDir)) {
  const yargsFile = path.join(yargsDir, 'yargs');
  const yargsCjsFile = path.join(yargsDir, 'yargs.cjs');
  if (fs.existsSync(yargsFile)) {
    fs.copyFileSync(yargsFile, yargsCjsFile);
  }

  const pkgFile = path.join(yargsDir, 'package.json');
  if (fs.existsSync(pkgFile)) {
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
    pkg.exports = pkg.exports || {};
    pkg.exports['./yargs'] = [
      {
        import: './yargs.mjs',
        require: './yargs.cjs'
      },
      './yargs.cjs'
    ];
    fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2));
  }
  console.log('[fix-yargs] Patched node_modules/yargs for Node 25 compatibility');
}
