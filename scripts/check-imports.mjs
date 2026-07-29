// Verifie que tout import relatif resout vers un fichier existant.
// C'est exactement le controle qui manquait : les tests couvraient le calcul,
// pas le graphe d'imports.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2];
const FILES = process.argv.slice(3);
const EXT = ['', '.js', '.jsx', '.ts', '.tsx', '.mjs', '/index.js'];
let bad = 0, checked = 0;

for (const rel of FILES) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) { console.log(`ABSENT  ${rel}`); bad++; continue; }
  const src = fs.readFileSync(abs, 'utf8');
  const re = /(?:import|from)\s+['"](\.[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    checked++;
    const target = path.resolve(path.dirname(abs), m[1]);
    const ok = EXT.some(e => fs.existsSync(target + e));
    console.log(`${ok ? 'OK     ' : 'CASSE  '} ${rel}  ->  ${m[1]}`);
    if (!ok) bad++;
  }
}
console.log(`\n${checked} imports relatifs verifies, ${bad} casse(s)`);
process.exit(bad ? 1 : 0);
