// Section 12.3: hex/rgb/hsl colour literals are disallowed outside ui/tokens.css.
// ESLint covers TS/TSX; this covers the stylesheets.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const bad = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.css') && !p.endsWith(`ui${sep}tokens.css`)) {
      readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
        if (/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(line)) bad.push(`${relative(root, p)}:${i + 1}  ${line.trim()}`);
      });
    }
  }
};
walk(root);
if (bad.length) { console.error('Colour literals outside tokens.css:\n' + bad.join('\n')); process.exit(1); }
console.log('check-colors: no colour literals outside tokens.css');
