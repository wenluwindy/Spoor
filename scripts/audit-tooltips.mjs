// One-off audit: interactive elements (<button>/<label>) missing title/aria-label.
import fs from 'node:fs';
import path from 'node:path';

function walk(dir, acc = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, acc);
    else if (name.endsWith('.tsx')) acc.push(p);
  }
  return acc;
}

const files = walk('src');
let total = 0;
const missing = [];

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const re = /<(button|label)\b/g;
  let m;
  while ((m = re.exec(src))) {
    let depth = 0;
    let end = -1;
    for (let k = m.index; k < src.length; k++) {
      const c = src[k];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) {
        end = k;
        break;
      }
    }
    if (end < 0) continue;
    const tag = src.slice(m.index, end + 1);
    total++;
    if (!/\btitle=|\baria-label=/.test(tag)) {
      const line = src.slice(0, m.index).split('\n').length;
      missing.push({ file: file.split(path.sep).join('/'), line });
    }
  }
}

console.log(`可交互元素: ${total} | 缺 tooltip: ${missing.length}`);
const byFile = new Map();
for (const { file, line } of missing) {
  if (!byFile.has(file)) byFile.set(file, []);
  byFile.get(file).push(line);
}
for (const [file, lines] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${file.padEnd(46)} ${String(lines.length).padStart(2)} 处  行: ${lines.join(', ')}`);
}
