const fs = require('fs');
const path = require('path');

const dir = '/Users/kevinkarlsson/Desktop/Documents/Zephind/scraper-service/src/services';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts'));

for (const file of files) {
  const fp = path.join(dir, file);
  let content = fs.readFileSync(fp, 'utf8');
  let original = content;

  // mitsui.ts
  content = content.replace(
    /Array\.from\(document\.querySelectorAll\("a:contains\('詳細を見る'\), a\[href\^\='\/bkdetail\/'\]"\)\)/g,
    'Array.from(document.querySelectorAll("a")).filter(a => (a.textContent && a.textContent.includes("詳細を見る")) || a.href.includes("/bkdetail/"))'
  );
  content = content.replace(
    /Array\.from\(document\.querySelectorAll\("a:contains\('詳細を見る'\), a\[href\*='\/bkdetail\/'\]"\)\)/g,
    'Array.from(document.querySelectorAll("a")).filter(a => (a.textContent && a.textContent.includes("詳細を見る")) || a.href.includes("/bkdetail/"))'
  );
  content = content.replace(
    /el\.querySelector\("a:contains\('詳細を見る'\), a\[href\*='\/bkdetail\/'\]"\)/g,
    'Array.from(el.querySelectorAll("a")).find(a => (a.textContent && a.textContent.includes("詳細を見る")) || a.href.includes("/bkdetail/"))'
  );

  // haseko, keio, daikyo, tokyotatemono, odakyu, sumai1
  content = content.replace(
    /Array\.from\(document\.querySelectorAll\("a:contains\('詳細'\), a\[href\*='\/detail\/'\], a\[href\*='search'\]"\)\)/g,
    'Array.from(document.querySelectorAll("a")).filter(a => (a.textContent && a.textContent.includes("詳細")) || a.href.includes("/detail/") || a.href.includes("search"))'
  );
  content = content.replace(
    /Array\.from\(document\.querySelectorAll\("a\[href\*='\/detail\/'\], a:contains\('詳細'\), a\[href\*='search'\]"\)\)/g,
    'Array.from(document.querySelectorAll("a")).filter(a => (a.textContent && a.textContent.includes("詳細")) || a.href.includes("/detail/") || a.href.includes("search"))'
  );
  content = content.replace(
    /Array\.from\(document\.querySelectorAll\("a:contains\('詳細'\), a\[href\*='\/detail\/'\], a\[href\*='\/buy\/'\]"\)\)/g,
    'Array.from(document.querySelectorAll("a")).filter(a => (a.textContent && a.textContent.includes("詳細")) || a.href.includes("/detail/") || a.href.includes("/buy/"))'
  );
  content = content.replace(
    /Array\.from\(document\.querySelectorAll\("a:contains\('詳細'\), a\[href\*='\/detail\/'\]"\)\)/g,
    'Array.from(document.querySelectorAll("a")).filter(a => (a.textContent && a.textContent.includes("詳細")) || a.href.includes("/detail/"))'
  );
  content = content.replace(
    /el\.querySelector\("a\[href\*='\/detail\/'\], a:contains\('詳細'\)"\)/g,
    'Array.from(el.querySelectorAll("a")).find(a => (a.textContent && a.textContent.includes("詳細")) || a.href.includes("/detail/"))'
  );
  content = content.replace(
    /el\.querySelector\("a:contains\('詳細'\), a\[href\*='\/detail\/'\]"\)/g,
    'Array.from(el.querySelectorAll("a")).find(a => (a.textContent && a.textContent.includes("詳細")) || a.href.includes("/detail/"))'
  );

  // mizuho
  content = content.replace(
    /Array\.from\(document\.querySelectorAll\("a:contains\('詳細を表示'\), a\[href\*='\/buy\/'\]"\)\)/g,
    'Array.from(document.querySelectorAll("a")).filter(a => (a.textContent && a.textContent.includes("詳細を表示")) || a.href.includes("/buy/"))'
  );
  content = content.replace(
    /el\.querySelector\("a:contains\('詳細を表示'\), a\[href\*='\/buy\/'\]"\)/g,
    'Array.from(el.querySelectorAll("a")).find(a => (a.textContent && a.textContent.includes("詳細を表示")) || a.href.includes("/buy/"))'
  );

  // next button generic fixes
  content = content.replace(
    /document\.querySelector\("\.pagination a:contains\('次へ'\), a:contains\('次へ'\)"\)/g,
    'Array.from(document.querySelectorAll("a")).find(a => a.textContent && a.textContent.includes("次へ"))'
  );
  content = content.replace(
    /document\.querySelector\("\.c_pager__next a, a:contains\('次へ'\)"\)/g,
    '(document.querySelector(".c_pager__next a") || Array.from(document.querySelectorAll("a")).find(a => a.textContent && a.textContent.includes("次へ")))'
  );
  content = content.replace(
    /document\.querySelector\("\.pager li\.next a, a\.next, a:contains\('次へ'\)"\)/g,
    '(document.querySelector(".pager li.next a, a.next") || Array.from(document.querySelectorAll("a")).find(a => a.textContent && a.textContent.includes("次へ")))'
  );
  content = content.replace(
    /document\.querySelector\("a:contains\('次へ>>'\)"\)/g,
    'Array.from(document.querySelectorAll("a")).find(a => a.textContent && a.textContent.includes("次へ>>"))'
  );


  if (content !== original) {
    fs.writeFileSync(fp, content);
    console.log('Fixed', file);
  }
}
